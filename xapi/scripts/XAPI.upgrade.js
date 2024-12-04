const { ethers, upgrades } = require("hardhat");

async function upgrade(oldAddress) {
    const XAPI = await ethers.getContractFactory("XAPI");
    await upgrades.upgradeProxy(oldAddress, XAPI);
    console.log("XAPI upgraded");
}

upgrade("0x954D3F9bcaEC245150B6DBfAd6A63806EBa13eCc");
