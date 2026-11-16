// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title P2PEscrow  (UNAUDITED. Do not use with real money before an independent audit.)
/// @notice Holds stablecoins for a P2P marketplace. The contract never touches gourdes.
///
/// Who can do what:
///  - Seller/buyer: deposit and withdraw their own free balance. They can also sign a withdraw
///    and let the operator send it, so they need no ETH for gas (a small fee, capped by the user, goes to feeRecipient).
///  - Operator (the app server key): reserve funds for an ad, lock funds into an order,
///    mark that the buyer says "I paid", cancel an order that was NOT marked paid.
///    The operator can NEVER release funds to a buyer and can NEVER move funds to itself.
///  - Release to the buyer: only the seller, a seller signature, or the arbiter.
///  - Arbiter (dispute staff key): release to buyer or refund to seller, any time.
///  - If an order was never marked paid and a day has passed, the seller can take it back alone.
/// Danger left on purpose: if the operator key AND the arbiter key are both stolen, funds can be stolen.
contract P2PEscrow {
    // ---------- types ----------
    enum Status { None, Locked, Released, Refunded }

    struct Order {
        address token;
        address seller;
        address buyer;
        uint128 amount;   // what the buyer gets
        uint128 fee;      // what the platform gets (paid by the seller)
        uint64  lockedAt;
        bool    claimed;  // buyer says they paid. After this the operator cannot cancel.
        Status  status;
    }

    // ---------- state ----------
    address public owner;
    address public operator;
    address public arbiter;
    address public feeRecipient;
    bool    public paused;
    uint256 public constant SELLER_SELF_REFUND_AFTER = 1 days;

    mapping(address => mapping(address => uint256)) public available; // token => user => free balance
    mapping(address => mapping(address => uint256)) public reserved;  // token => user => held for ads
    mapping(bytes32 => Order) public orders;
    uint256 private _guard = 1;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant RELEASE_TYPEHASH = keccak256("Release(bytes32 orderId,uint256 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(address token,uint256 amount,address to,uint256 maxFee,uint256 nonce,uint256 deadline)");
    mapping(address => uint256) public nonces;   // one per user, so a signed withdraw can be used only once

    // ---------- events (the app reads these) ----------
    event Deposited(address indexed token, address indexed user, uint256 amount);
    event Withdrawn(address indexed token, address indexed user, uint256 amount);
    event Reserved(address indexed token, address indexed user, uint256 amount);
    event Unreserved(address indexed token, address indexed user, uint256 amount);
    event Locked(bytes32 indexed orderId, address indexed token, address seller, address buyer, uint256 amount, uint256 fee);
    event Claimed(bytes32 indexed orderId);
    event Released(bytes32 indexed orderId, address by);
    event Refunded(bytes32 indexed orderId, address by);
    event RolesChanged(address operator, address arbiter, address feeRecipient);
    event PausedSet(bool paused);
    event WithdrawFee(address indexed token, address indexed user, uint256 fee);

    // ---------- guards ----------
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    modifier nonReentrant() { require(_guard == 1, "reentrant"); _guard = 2; _; _guard = 1; }

    constructor(address _operator, address _arbiter, address _feeRecipient) {
        require(_operator != address(0) && _arbiter != address(0) && _feeRecipient != address(0), "zero address");
        owner = msg.sender;
        operator = _operator;
        arbiter = _arbiter;
        feeRecipient = _feeRecipient;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("P2PEscrow"), keccak256("1"), block.chainid, address(this)));
    }

    // ---------- admin ----------
    function setRoles(address _operator, address _arbiter, address _feeRecipient) external onlyOwner {
        require(_operator != address(0) && _arbiter != address(0) && _feeRecipient != address(0), "zero address");
        operator = _operator; arbiter = _arbiter; feeRecipient = _feeRecipient;
        emit RolesChanged(_operator, _arbiter, _feeRecipient);
    }
    /// Pause only stops NEW deposits, reserves and locks. Withdraw, release and refund always work.
    function setPaused(bool p) external onlyOwner { paused = p; emit PausedSet(p); }
    function transferOwnership(address o) external onlyOwner { require(o != address(0), "zero address"); owner = o; }

    // ---------- user balance ----------
    function deposit(address token, uint256 amount) external nonReentrant {
        require(!paused, "paused");
        require(amount > 0, "zero amount");
        uint256 before = _bal(token);
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 got = _bal(token) - before;           // protects against fee-on-transfer tokens
        require(got == amount, "token took a fee");
        available[token][msg.sender] += amount;
        emit Deposited(token, msg.sender, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(amount > 0 && available[token][msg.sender] >= amount, "not enough free balance");
        available[token][msg.sender] -= amount;       // state first, then transfer
        _safeTransfer(token, msg.sender, amount);
        emit Withdrawn(token, msg.sender, amount);
    }

    /// Gasless withdraw. The user signs (token, amount, to, maxFee, nonce, deadline) in their wallet.
    /// The operator sends it and pays the gas. The operator picks the fee, never above the signed maxFee.
    /// The fee is credited to feeRecipient inside the contract. The rest goes to `to`.
    /// The operator cannot change the token, the amount, where it goes, or use the signature twice.
    function withdrawWithSig(address user, address token, uint256 amount, address to, uint256 fee,
                             uint256 maxFee, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external nonReentrant onlyOperator
    {
        require(block.timestamp <= deadline, "signature expired");
        require(to != address(0) && user != address(0), "zero address");
        require(fee <= maxFee && fee < amount, "bad fee");
        require(available[token][user] >= amount, "not enough free balance");
        uint256 nonce = nonces[user];
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(WITHDRAW_TYPEHASH, token, amount, to, maxFee, nonce, deadline))));
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "bad s");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == user, "bad signature");
        nonces[user] = nonce + 1;
        available[token][user] -= amount;              // state first, then transfer
        if (fee > 0) available[token][feeRecipient] += fee;
        _safeTransfer(token, to, amount - fee);
        emit Withdrawn(token, user, amount);
        emit WithdrawFee(token, user, fee);
    }

    // ---------- operator: ads and orders ----------
    function reserve(address user, address token, uint256 amount) external onlyOperator {
        require(!paused, "paused");
        require(available[token][user] >= amount, "not enough free balance");
        available[token][user] -= amount;
        reserved[token][user] += amount;
        emit Reserved(token, user, amount);
    }

    function unreserve(address user, address token, uint256 amount) external onlyOperator {
        require(reserved[token][user] >= amount, "not enough reserved");
        reserved[token][user] -= amount;
        available[token][user] += amount;
        emit Unreserved(token, user, amount);
    }

    function lock(bytes32 orderId, address seller, address buyer, address token,
                  uint256 amount, uint256 fee, bool fromReserved) external onlyOperator {
        require(!paused, "paused");
        require(orders[orderId].status == Status.None, "order exists");
        require(amount > 0 && amount <= type(uint128).max && fee <= type(uint128).max, "bad amount");
        require(seller != address(0) && buyer != address(0) && seller != buyer, "bad parties");
        uint256 total = amount + fee;
        if (fromReserved) {
            require(reserved[token][seller] >= total, "not enough reserved");
            reserved[token][seller] -= total;
        } else {
            require(available[token][seller] >= total, "not enough free balance");
            available[token][seller] -= total;
        }
        orders[orderId] = Order(token, seller, buyer, uint128(amount), uint128(fee),
                                uint64(block.timestamp), false, Status.Locked);
        emit Locked(orderId, token, seller, buyer, amount, fee);
    }

    /// The buyer said "I paid". From now on the operator cannot cancel this order.
    function markClaimed(bytes32 orderId) external onlyOperator {
        Order storage o = orders[orderId];
        require(o.status == Status.Locked, "not locked");
        o.claimed = true;
        emit Claimed(orderId);
    }

    // ---------- exits ----------
    /// Seller confirms the gourdes arrived, or the arbiter decides for the buyer.
    function release(bytes32 orderId) external {
        Order storage o = orders[orderId];
        require(msg.sender == o.seller || msg.sender == arbiter, "not allowed");
        _release(orderId, o, msg.sender);
    }

    /// Anyone can send this. It needs the seller's signed approval, so the seller can approve
    /// from the app without paying gas.
    function releaseWithSig(bytes32 orderId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "signature expired");
        Order storage o = orders[orderId];
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(RELEASE_TYPEHASH, orderId, deadline))));
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "bad s");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == o.seller, "bad signature");
        _release(orderId, o, signer);
    }

    /// Give the crypto back to the seller.
    ///  - arbiter: any time while locked
    ///  - operator: only if the buyer never said "I paid"
    ///  - seller: only if the buyer never said "I paid" and one day has passed
    /// toReserved=true puts it back into the seller's ad reserve (only the operator may choose that).
    function refund(bytes32 orderId, bool toReserved) external {
        Order storage o = orders[orderId];
        require(o.status == Status.Locked, "not locked");
        if (msg.sender == arbiter) {
            require(!toReserved, "arbiter refunds to free balance");
        } else if (msg.sender == operator) {
            require(!o.claimed, "buyer already claimed payment");
        } else if (msg.sender == o.seller) {
            require(!o.claimed, "buyer already claimed payment");
            require(block.timestamp >= o.lockedAt + SELLER_SELF_REFUND_AFTER, "too early");
            require(!toReserved, "seller refunds to free balance");
        } else {
            revert("not allowed");
        }
        o.status = Status.Refunded;
        uint256 total = uint256(o.amount) + o.fee;
        if (toReserved) reserved[o.token][o.seller] += total;
        else available[o.token][o.seller] += total;
        emit Refunded(orderId, msg.sender);
    }

    // ---------- internals ----------
    function _release(bytes32 orderId, Order storage o, address by) private {
        require(o.status == Status.Locked, "not locked");
        o.status = Status.Released;
        available[o.token][o.buyer] += o.amount;
        if (o.fee > 0) available[o.token][feeRecipient] += o.fee;
        emit Released(orderId, by);
    }

    function _bal(address token) private view returns (uint256) {
        (bool ok, bytes memory d) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        require(ok && d.length >= 32, "balanceOf failed");
        return abi.decode(d, (uint256));
    }

    // Works with tokens that return nothing (like Ethereum USDT) and tokens that return true.
    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory d) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "transfer failed");
    }
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory d) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        require(ok && (d.length == 0 || abi.decode(d, (bool))), "transferFrom failed");
    }
}
