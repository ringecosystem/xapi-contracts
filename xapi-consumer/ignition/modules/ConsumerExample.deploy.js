const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x7DE29a6ee2d6B1BfC4DE88d278107Cf65261f698"], {
        from: deployer
    });

    return { consumer }
});