const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x844EB21C712914cC25Fa0Df8330f02b58495B250"], {
        from: deployer
    });

    return { consumer }
});