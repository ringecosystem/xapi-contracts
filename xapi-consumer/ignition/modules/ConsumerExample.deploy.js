const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x6D83b038d5bF428a8C3fF34bf1b380b3A2acA6fe"], {
        from: deployer
    });

    return { consumer }
});