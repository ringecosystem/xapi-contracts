// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "./interfaces/IXAPI.sol";
import "./lib/XAPIBuilder.sol";

string constant PROTOCOL_NAME = "XAPI";
string constant PROTOCOL_VERSION = "1";

contract XAPI is Initializable, IXAPI, EIP712Upgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
    uint256 public requestCount;
    mapping(uint256 => Request) public requests;
    mapping(address => AggregatorConfig) public aggregatorConfigs;
    mapping(address => uint256) public rewards;

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        __EIP712_init(PROTOCOL_NAME, PROTOCOL_VERSION);
    }

    function makeRequest(XAPIBuilder.Request memory requestData) external payable override returns (uint256) {
        require(msg.sender != address(this), "CANT call self");
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[requestData.exAggregator];
        require(aggregatorConfig.version != 0, "!Aggregator");
        require(!aggregatorConfig.suspended, "Suspended");

        uint256 feeRequired = aggregatorConfig.reportersFee + aggregatorConfig.publishFee;
        require(msg.value == feeRequired, "!value");

        requestCount++;
        uint256 requestId = _encodeRequestId(requestCount);
        requests[requestId] = Request({
            requester: msg.sender,
            status: RequestStatus.Pending,
            reportersFee: aggregatorConfig.reportersFee,
            publishFee: aggregatorConfig.publishFee,
            aggregator: aggregatorConfig.aggregator,
            response: ResponseData({
                reporters: new address[](0),
                result: new bytes(0),
                errorCode: 0,
                publisherPaymaster: address(0)
            }),
            requestData: requestData
        });
        emit RequestMade(
            requestId,
            aggregatorConfig.aggregator,
            requestData,
            msg.sender,
            aggregatorConfig.reportersFee,
            aggregatorConfig.publishFee
        );
        return requestId;
    }

    function fulfill(EIP712Response memory response, bytes memory signature) external override {
        Request storage request = requests[response.requestId];
        require(_decodeChainId(response.requestId) == block.chainid, "!chainId");
        require(request.requester != address(0), "!Request");
        (address _exAggregator,) = verifyResponseSignature(response, signature);
        require(_exAggregator == request.requestData.exAggregator, "!exAggregator address");
        require(request.status == RequestStatus.Pending, "!Pending");

        ResponseData memory _responseData = ResponseData({
            reporters: response.reporters,
            result: response.result,
            errorCode: response.errorCode,
            publisherPaymaster: msg.sender
        });
        request.response = _responseData;

        for (uint256 i = 0; i < response.reporters.length; i++) {
            rewards[response.reporters[i]] += request.reportersFee / response.reporters.length;
        }
        rewards[msg.sender] += request.publishFee;

        (bool success,) = request.requester.call(
            abi.encodeWithSelector(request.requestData.callbackFunctionId, response.requestId, request.response)
        );

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(response.requestId, request.response, request.status);
    }

    function retryCallback(uint256 requestId) external override {
        Request storage request = requests[requestId];
        require(request.status == RequestStatus.CallbackFailed, "!Callback failed request");
        require(msg.sender == request.requester, "!Requester");

        (bool success,) = request.requester.call(
            abi.encodeWithSelector(request.requestData.callbackFunctionId, requestId, request.response)
        );

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(requestId, request.response, request.status);
    }

    function withdrawRewards() external override {
        uint256 amount = rewards[msg.sender];
        require(amount > 0, "Insufficient rewards");

        rewards[msg.sender] = 0;
        emit RewardsWithdrawn(msg.sender, amount);

        payable(msg.sender).transfer(amount);
    }

    function setAggregatorConfig(EIP712AggregatorConfig memory aggregatorConfig, bytes memory signature)
        external
        override
    {
        (address exAggregator,) = verifyAggregatorConfigSignature(aggregatorConfig, signature);
        require(exAggregator != address(0), "Invalid signature");
        aggregatorConfigs[exAggregator] = AggregatorConfig({
            aggregator: aggregatorConfig.aggregator,
            reportersFee: aggregatorConfig.reportersFee,
            publishFee: aggregatorConfig.publishFee,
            version: aggregatorConfig.version,
            suspended: false
        });

        emit AggregatorConfigSet(
            exAggregator,
            aggregatorConfig.reportersFee,
            aggregatorConfig.publishFee,
            aggregatorConfig.aggregator,
            aggregatorConfig.version
        );
    }

    function fee(address exAggregator) external view override returns (uint256) {
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[exAggregator];
        require(aggregatorConfig.version != 0, "!Aggregator");
        return aggregatorConfig.reportersFee + aggregatorConfig.publishFee;
    }

    function suspendAggregator(address exAggregator) external override onlyOwner {
        require(aggregatorConfigs[exAggregator].version != 0, "!Aggregator");
        aggregatorConfigs[exAggregator].suspended = true;

        emit AggregatorSuspended(exAggregator, aggregatorConfigs[exAggregator].aggregator);
    }

    function _encodeRequestId(uint256 count) internal view returns (uint256) {
        return (block.chainid << 192) | count;
    }

    function _decodeChainId(uint256 requestId) internal pure returns (uint256) {
        return requestId >> 192;
    }

    bytes32 public constant EIP712_AGGREGATOR_CONFIG_TYPE_HASH =
        keccak256("EIP712AggregatorConfig(string aggregator,uint256 reportersFee,uint256 publishFee,uint256 version)");

    function verifyAggregatorConfigSignature(EIP712AggregatorConfig memory aggregatorConfig, bytes memory signature)
        public
        view
        override
        returns (address, bytes32)
    {
        bytes32 digest = _hashTypedDataV4(hashAggregatorConfig(aggregatorConfig));
        (uint8 v, bytes32 r, bytes32 s) = _splitSignature(signature);
        return (ecrecover(digest, v, r, s), digest);
    }

    function hashAggregatorConfig(EIP712AggregatorConfig memory aggregatorConfig) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_AGGREGATOR_CONFIG_TYPE_HASH,
                keccak256(bytes(aggregatorConfig.aggregator)),
                aggregatorConfig.reportersFee,
                aggregatorConfig.publishFee,
                aggregatorConfig.version
            )
        );
    }

    bytes32 public constant EIP712_RESPONSE_TYPE_HASH =
        keccak256("EIP712Response(uint256 requestId,address[] reporters,bytes result,uint16 errorCode)");

    function verifyResponseSignature(EIP712Response memory response, bytes memory signature)
        public
        view
        override
        returns (address, bytes32)
    {
        bytes32 digest = _hashTypedDataV4(hashResponse(response));
        (uint8 v, bytes32 r, bytes32 s) = _splitSignature(signature);
        return (ecrecover(digest, v, r, s), digest);
    }

    function hashResponse(EIP712Response memory response) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_RESPONSE_TYPE_HASH,
                response.requestId,
                response.reporters,
                keccak256(response.result),
                response.errorCode
            )
        );
    }

    function _splitSignature(bytes memory signature) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        require(signature.length == 65, "Invalid signature length");

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
    }
}
