const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0x7535409663129A387e3e95fE18b940eaE04C2F25"], {
        from: deployer
    });

    return { consumer }
});