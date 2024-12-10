// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "xapi/contracts/interfaces/IXAPI.sol";

interface IXAPIConsumer {
    function xapiCallback(uint256 requestId, ResponseData memory response) external;
    
    function retryCallback(uint256 requestId) external;
}