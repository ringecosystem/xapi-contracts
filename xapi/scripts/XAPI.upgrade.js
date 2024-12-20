const { ethers, upgrades } = require("hardhat");

async function upgrade(oldAddress) {
    const XAPI = await ethers.getContractFactory("XAPI");
    await upgrades.upgradeProxy(oldAddress, XAPI);
    console.log("XAPI upgraded");
}

upgrade("0x14028Eb4aEc20EE2490607A24A322c7587d75BAf");
