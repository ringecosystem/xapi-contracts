const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0xB78cbcD4389986Fe4F837d4fD92700543F1080a6"], {
        from: deployer
    });

    return { consumer }
});