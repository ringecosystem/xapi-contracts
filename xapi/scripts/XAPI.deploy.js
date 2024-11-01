const { ethers, upgrades } = require("hardhat");

async function deploy() {
    const XAPI = await ethers.getContractFactory("XAPI");
    const xapi = await upgrades.deployProxy(XAPI, ["0x9F33a4809aA708d7a399fedBa514e0A0d15EfA85"]);
    await xapi.waitForDeployment();
    console.log("XAPI deployed to:", await xapi.getAddress());
}

deploy();
