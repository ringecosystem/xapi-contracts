const { ethers, upgrades } = require("hardhat");

async function upgrade(oldAddress) {
    const XAPI = await ethers.getContractFactory("XAPI");
    await upgrades.upgradeProxy(oldAddress, XAPI);
    console.log("XAPI upgraded");
}

upgrade("0x258E2B5bFCf2DF7e633B95abDc81A43C2073dA6d");
