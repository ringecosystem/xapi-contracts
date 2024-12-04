const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x954D3F9bcaEC245150B6DBfAd6A63806EBa13eCc"], {
        from: deployer
    });

    return { consumer }
});