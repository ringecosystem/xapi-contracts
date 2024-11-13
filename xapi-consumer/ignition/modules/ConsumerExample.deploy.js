const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0xF9105d29A6222fB832C20669A8E4dFD40ECd9f29"], {
        from: deployer
    });

    return { consumer }
});