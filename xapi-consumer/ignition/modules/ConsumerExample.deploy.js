const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x14028Eb4aEc20EE2490607A24A322c7587d75BAf"], {
        from: deployer
    });

    return { consumer }
});