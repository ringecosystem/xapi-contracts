const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const configTypes = {
  EIP712AggregatorConfig: [
    { name: "aggregator", type: "string" },
    { name: "reportersFee", type: "uint256" },
    { name: "publishFee", type: "uint256" },
    { name: "version", type: "uint256" },
  ],
};

async function signingDomain(contract) {
  const network = await ethers.provider.getNetwork();
  return {
    name: "XAPI",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await contract.getAddress(),
  };
}

describe("XAPI", function () {
  async function deployXAPIFixture() {
    const [owner] = await ethers.getSigners();
    const XAPI = await ethers.getContractFactory("XAPI");
    const xapi = await upgrades.deployProxy(XAPI, [owner.address]);
    await xapi.waitForDeployment();
    return { xapi, owner };
  }

  async function configureAggregator(xapi, aggregator) {
    const config = {
      aggregator: "testAggregator",
      reportersFee: 500n,
      publishFee: 1000n,
      version: 1n,
    };
    const signature = await aggregator.signTypedData(
      await signingDomain(xapi),
      configTypes,
      config
    );
    await xapi.setAggregatorConfig(config, signature);
    return config;
  }

  function makeRequestData(aggregator) {
    return {
      exAggregator: aggregator.address,
      callbackFunctionId: "0x12345678",
      buf: { buf: "0xa0", capacity: 1n },
    };
  }

  it("initializes ownership", async function () {
    const { xapi, owner } = await loadFixture(deployXAPIFixture);
    expect(await xapi.owner()).to.equal(owner.address);
  });

  it("stores a signed aggregator configuration", async function () {
    const { xapi, owner } = await loadFixture(deployXAPIFixture);
    const config = await configureAggregator(xapi, owner);
    const stored = await xapi.aggregatorConfigs(owner.address);
    expect(stored.aggregator).to.equal(config.aggregator);
    expect(stored.reportersFee).to.equal(config.reportersFee);
    expect(stored.publishFee).to.equal(config.publishFee);
    expect(stored.version).to.equal(config.version);
    expect(stored.suspended).to.equal(false);
  });

  it("creates a request with the configured fee", async function () {
    const { xapi, owner } = await loadFixture(deployXAPIFixture);
    const config = await configureAggregator(xapi, owner);
    const requestData = makeRequestData(owner);
    const requestArgs = [
      requestData.exAggregator,
      requestData.callbackFunctionId,
      [requestData.buf.buf, requestData.buf.capacity],
    ];
    const { chainId } = await ethers.provider.getNetwork();
    const requestId = (chainId << 192n) | 1n;
    const fee = config.reportersFee + config.publishFee;

    await expect(xapi.makeRequest(requestData, { value: fee }))
      .to.emit(xapi, "RequestMade")
      .withArgs(
        requestId,
        config.aggregator,
        requestArgs,
        owner.address,
        config.reportersFee,
        config.publishFee
      );

    const stored = await xapi.requests(requestId);
    expect(stored.requestData.toArray(true)).to.deep.equal(requestArgs);
    expect(stored.requester).to.equal(owner.address);
    expect(await xapi.requestCount()).to.equal(1);
    expect(await xapi.fee(owner.address)).to.equal(fee);
  });

  it("fulfills a request with a signed response", async function () {
    const { xapi, owner } = await loadFixture(deployXAPIFixture);
    const aggregator = ethers.Wallet.createRandom();
    const config = await configureAggregator(xapi, aggregator);
    await xapi.makeRequest(makeRequestData(aggregator), {
      value: config.reportersFee + config.publishFee,
    });

    const domain = await signingDomain(xapi);
    const requestId = (domain.chainId << 192n) | 1n;
    const response = {
      requestId,
      reporters: [aggregator.address],
      result: "0x1234",
      errorCode: 0n,
      publisherPaymaster: owner.address,
    };
    const digest = ethers.solidityPackedKeccak256(
      ["bytes2", "bytes32", "bytes32"],
      ["0x1901", ethers.TypedDataEncoder.hashDomain(domain), await xapi.hashResponse(response)]
    );
    const signature = aggregator.signingKey.sign(digest).serialized;

    const fulfilled = 1n;
    const responseArgs = [
      response.reporters,
      response.result,
      response.errorCode,
      response.publisherPaymaster,
    ];
    await expect(xapi.fulfill(response, signature))
      .to.emit(xapi, "Fulfilled")
      .withArgs(requestId, responseArgs, fulfilled);
    const request = await xapi.requests(requestId);
    expect(request.status).to.equal(fulfilled);
    expect(request.response.toArray(true)).to.deep.equal(responseArgs);
    expect(await xapi.rewards(aggregator.address)).to.equal(config.reportersFee);
    expect(await xapi.rewards(owner.address)).to.equal(config.publishFee);
  });
});
