// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IXAPI.sol";
import "./lib/XAPIBuilder.sol";

string constant PROTOCOL_NAME = "XAPI";
string constant PROTOCOL_VERSION = "1";

contract XAPI is Initializable, IXAPI, Ownable2StepUpgradeable, UUPSUpgradeable {
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

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256(bytes(PROTOCOL_NAME)),
                keccak256(bytes(PROTOCOL_VERSION)),
                block.chainid,
                // todo update  address(this)
                address(0x9F33a4809aA708d7a399fedBa514e0A0d15EfA85)
            )
        );
    }

    function makeRequest(XAPIBuilder.Request memory requestData) external payable override returns (uint256) {
        require(msg.sender != address(this), "CANT call self");
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[requestData.exAggregator];
        require(aggregatorConfig.rewardAddress != address(0), "!Aggregator");
        require(!aggregatorConfig.suspended, "Suspended");

        uint256 feeRequired = aggregatorConfig.reportersFee + aggregatorConfig.publishFee;
        require(msg.value == feeRequired, "!value");

        requestCount++;
        uint256 requestId = encodeRequestId(requestCount);
        requests[requestId] = Request({
            requester: msg.sender,
            status: RequestStatus.Pending,
            reportersFee: aggregatorConfig.reportersFee,
            publishFee: aggregatorConfig.publishFee,
            aggregator: aggregatorConfig.aggregator,
            response: ResponseData({reporters: new address[](0), result: new bytes(0), errorCode: 0}),
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

    function fulfill(uint256 requestId, ResponseData memory response) external override {
        Request storage request = requests[requestId];
        require(decodeChainId(requestId) == block.chainid, "!chainId");
        require(request.requestData.exAggregator != address(0), "!Request");
        require(msg.sender == request.requestData.exAggregator, "!exAggregator address");
        require(request.status == RequestStatus.Pending, "!Pending");

        request.response = response;

        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[msg.sender];
        for (uint256 i = 0; i < response.reporters.length; i++) {
            rewards[response.reporters[i]] += request.reportersFee / response.reporters.length;
        }
        rewards[aggregatorConfig.rewardAddress] += request.publishFee;

        (bool success,) =
            request.requester.call(abi.encodeWithSelector(request.requestData.callbackFunctionId, requestId, response));

        request.status = success ? RequestStatus.Fulfilled : RequestStatus.CallbackFailed;

        emit Fulfilled(requestId, request.response, request.status);
    }

    function retryFulfill(uint256 requestId) external override {
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

    function setAggregatorConfig(
        string memory aggregator,
        uint256 reportersFee,
        uint256 publishFee,
        address rewardAddress,
        uint256 version
    ) external override {
        aggregatorConfigs[msg.sender] = AggregatorConfig({
            aggregator: aggregator,
            reportersFee: reportersFee,
            publishFee: publishFee,
            rewardAddress: rewardAddress,
            version: version,
            suspended: false
        });

        emit AggregatorConfigSet(msg.sender, reportersFee, publishFee, aggregator, rewardAddress, version);
    }

    function fee(address exAggregator) external view override returns (uint256) {
        AggregatorConfig memory aggregatorConfig = aggregatorConfigs[exAggregator];
        require(aggregatorConfig.rewardAddress != address(0), "!Aggregator");
        return aggregatorConfig.reportersFee + aggregatorConfig.publishFee;
    }

    function suspendAggregator(address exAggregator) external override onlyOwner {
        require(aggregatorConfigs[exAggregator].rewardAddress != address(0), "!Aggregator");
        aggregatorConfigs[exAggregator].suspended = true;

        emit AggregatorSuspended(exAggregator, aggregatorConfigs[exAggregator].aggregator);
    }

    function encodeRequestId(uint256 count) internal view returns (uint256) {
        return (block.chainid << 192) | count;
    }

    function decodeChainId(uint256 requestId) internal pure returns (uint256) {
        return requestId >> 192;
    }

    struct EIP712AggregatorConfig {
        string aggregator;
        address rewardAddress;
        uint256 reportersFee;
        uint256 publishFee;
        uint256 version;
    }

    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

    bytes32 public DOMAIN_SEPARATOR;

    bytes32 public constant EIP712DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant AGGREGATOR_CONFIG_EIP712_TYPE_HASH = keccak256(
        "AggregatorConfig(string aggregator,address rewardAddress,uint256 reportersFee,uint256 publishFee,uint256 version)"
    );

    function verifySignature(EIP712AggregatorConfig memory aggregatorConfig, uint8 v, bytes32 r, bytes32 s)
        public
        view
        returns (bytes32, address)
    {
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hashAggregatorConfig(aggregatorConfig)));
        return (digest, ecrecover(digest, v, r, s));
    }

    function hashAggregatorConfig(EIP712AggregatorConfig memory aggregatorConfig) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                AGGREGATOR_CONFIG_EIP712_TYPE_HASH,
                keccak256(bytes(aggregatorConfig.aggregator)),
                aggregatorConfig.rewardAddress,
                aggregatorConfig.reportersFee,
                aggregatorConfig.publishFee,
                aggregatorConfig.version
            )
        );
    }
}
