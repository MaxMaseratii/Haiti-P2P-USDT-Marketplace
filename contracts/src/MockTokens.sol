// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
// TEST ONLY. Two fake tokens: one returns bool (USDC style), one returns nothing (USDT style).
contract MockToken {
    string public name; uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    constructor(string memory n) { name = n; }
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { _mv(msg.sender, to, a); return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance"); allowance[f][msg.sender] -= a; _mv(f, to, a); return true;
    }
    function _mv(address f, address t, uint256 a) internal { require(balanceOf[f] >= a, "balance"); balanceOf[f] -= a; balanceOf[t] += a; }
}
contract MockNoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external { allowance[msg.sender][s] = a; }
    function transfer(address to, uint256 a) external { _mv(msg.sender, to, a); }
    function transferFrom(address f, address to, uint256 a) external {
        require(allowance[f][msg.sender] >= a, "allowance"); allowance[f][msg.sender] -= a; _mv(f, to, a);
    }
    function _mv(address f, address t, uint256 a) internal { require(balanceOf[f] >= a, "balance"); balanceOf[f] -= a; balanceOf[t] += a; }
}
// Evil token that tries to re-enter withdraw() during transfer.
interface IEsc { function withdraw(address, uint256) external; }
contract MockReentrantToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public target; bool public attacked;
    function setTarget(address t) external { target = t; }
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        if (msg.sender == target && !attacked) { attacked = true; try IEsc(target).withdraw(address(this), 1) {} catch {} }
        require(balanceOf[msg.sender] >= a, "balance"); balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance"); allowance[f][msg.sender] -= a;
        require(balanceOf[f] >= a, "balance"); balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}
