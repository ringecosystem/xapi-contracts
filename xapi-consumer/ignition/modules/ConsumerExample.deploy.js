const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0xC32BDE0002D71fD9a6C64eED65bdFD6e72F4Deba"], {
        from: deployer
    });

    return { consumer }
});