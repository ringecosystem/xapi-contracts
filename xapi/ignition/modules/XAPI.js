const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("XAPIModule", (m) => {
  const xapi = m.contract("XAPI");

  const setAggregatorConfig = m.call(xapi, "setAggregatorConfig", [
    "exampleAggregator",
    m.getParameter("perReporterFee", 100000),
    m.getParameter("publishFee", 500000)
  ]);

  return { xapi: m.afterDeploy(xapi, [setAggregatorConfig]) };
});