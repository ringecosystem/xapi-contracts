const { ethers, upgrades } = require("hardhat");

async function upgrade(oldAddress) {
    const XAPI = await ethers.getContractFactory("XAPI");
    await upgrades.upgradeProxy(oldAddress, XAPI);
    console.log("XAPI upgraded");
}

upgrade("0x7DE29a6ee2d6B1BfC4DE88d278107Cf65261f698");
