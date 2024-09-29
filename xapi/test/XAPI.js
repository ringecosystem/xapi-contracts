const {
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers } = require("hardhat");

function encodeRequestId(chainId, count) {
  return chainId << 192n | BigInt(count);
}

describe("XAPI", function () {
  async function deployXAPIFixture() {
    const [owner, otherAccount] = await ethers.getSigners();

    const XAPI = await ethers.getContractFactory("XAPI");
    const xapi = await XAPI.deploy();

    return { xapi, owner, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { xapi, owner } = await loadFixture(deployXAPIFixture);
      expect(await xapi.owner()).to.equal(owner.address);
    });
  });

  describe("Aggregator Configuration", function () {
    it("Should set aggregator config correctly", async function () {
      const { xapi, owner } = await loadFixture(deployXAPIFixture);
      await xapi.setAggregatorConfig("testAggregator", 100, 1000, owner.address, owner.address, 5);
      const config = await xapi.aggregatorConfigs("testAggregator");
      expect(config.fulfillAddress).to.equal(owner.address);
      expect(config.perReporterFee).to.equal(100);
      expect(config.publishFee).to.equal(1000);
      expect(config.suspended).to.be.false;
    });

    it("Should only allow owner to set aggregator config", async function () {
      const { xapi, otherAccount } = await loadFixture(deployXAPIFixture);
      await expect(xapi.connect(otherAccount).setAggregatorConfig("testAggregator", 100, 1000, owner.address, owner.address, 5))
        .to.be.reverted;
    });
  });

  describe("Make Request", function () {
    it("Should create a new request", async function () {
      const { xapi, owner } = await loadFixture(deployXAPIFixture);
      await xapi.setAggregatorConfig("testAggregator", 100, 1000, owner.address, owner.address, 5);
      const requestData = "test data";
      const callbackFunction = "0x12345678";
      const requestFee = 1500; // 5 * 100 + 1000

      await expect(xapi.makeRequest(requestData, callbackFunction, "testAggregator", { value: requestFee }))
        .to.emit(xapi, "RequestMade")
        .withArgs(anyValue, "testAggregator", requestData, owner.address);
    });
  });

  describe("Fulfill Request", function () {
    it("Should fulfill a request", async function () {
      const { xapi, owner } = await loadFixture(deployXAPIFixture);
      // Setup and make a request first
      await xapi.setAggregatorConfig("testAggregator", 100, 1000, owner.address, owner.address, 5);
      const requestData = "test data";
      const callbackFunction = "0x12345678";
      const requestFee = 1500;
      await xapi.makeRequest(requestData, callbackFunction, "testAggregator", { value: requestFee });

      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const requestId = encodeRequestId(chainId, 1);
      console.log("requestId", requestId);
      // Now fulfill the request
      const response = {
        reporters: [owner.address, owner.address, owner.address],
        result: "0x1234"
      };
      await expect(xapi.fulfill(requestId, response))
        .to.emit(xapi, "Fulfilled")
        .withArgs(requestId, anyValue, anyValue);
    });
  });

});