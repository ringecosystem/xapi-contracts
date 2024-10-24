// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "xapi/contracts/interfaces/IXAPI.sol";

interface IXAPIConsumer {
    function xapiCallback(uint256 requestId, ResponseData memory response) external;
}