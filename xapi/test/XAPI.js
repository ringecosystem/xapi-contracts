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
      reportersFee: 500,
      publishFee: 1000,
      version: 1,
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
      buf: { buf: "0x", capacity: 0 },
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
    await configureAggregator(xapi, owner);
    await xapi.makeRequest(makeRequestData(owner), { value: 1500 });
    expect(await xapi.requestCount()).to.equal(1);
    expect(await xapi.fee(owner.address)).to.equal(1500);
  });

  it("fulfills a request with a signed response", async function () {
    const { xapi, owner } = await loadFixture(deployXAPIFixture);
    const aggregator = ethers.Wallet.createRandom();
    const config = await configureAggregator(xapi, aggregator);
    await xapi.makeRequest(makeRequestData(aggregator), { value: 1500 });

    const domain = await signingDomain(xapi);
    const requestId = (domain.chainId << 192n) | 1n;
    const response = {
      requestId,
      reporters: [aggregator.address],
      result: "0x1234",
      errorCode: 0,
      publisherPaymaster: owner.address,
    };
    const digest = ethers.solidityPackedKeccak256(
      ["bytes2", "bytes32", "bytes32"],
      ["0x1901", ethers.TypedDataEncoder.hashDomain(domain), await xapi.hashResponse(response)]
    );
    const signature = aggregator.signingKey.sign(digest).serialized;

    await expect(xapi.fulfill(response, signature)).to.emit(xapi, "Fulfilled");
    const request = await xapi.requests(requestId);
    expect(request.status).to.equal(1);
    expect(request.response.result).to.equal(response.result);
    expect(await xapi.rewards(aggregator.address)).to.equal(config.reportersFee);
    expect(await xapi.rewards(owner.address)).to.equal(config.publishFee);
  });
});
