const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x258E2B5bFCf2DF7e633B95abDc81A43C2073dA6d"], {
        from: deployer
    });

    return { consumer }
});