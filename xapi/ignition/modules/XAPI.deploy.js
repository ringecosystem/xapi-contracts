const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("XAPIModule", (m) => {
    const deployer = m.getAccount(0);

    const xapi = m.contract("XAPI", [], {
        from: deployer
    });

    return { xapi }
});