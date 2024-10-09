const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("ConsumerExampleModule", (m) => {
    const deployer = m.getAccount(0);

    const consumer = m.contract("ConsumerExample", ["0xcedBd5b942c37870D172fEF4FC1C568C0aB8c038"], {
        from: deployer
    });

    return { consumer }
});