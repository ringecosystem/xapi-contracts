// Find all our documentation at https://docs.near.org
import { NearBindgen, near, call, view } from 'near-sdk-js';
import { ContractBase, ContractSourceMetadata, Standard } from '../../common/src/standard.abstract';

@NearBindgen({})
class Staking extends ContractBase {

  constructor() {
    super(new ContractSourceMetadata({
      version: "",
      link: "",
      standards: [new Standard("nep330", "1.1.0"), new Standard("nep297", "1.0.0")]
    }))
  }

  // views

  @view({})
  contract_source_metadata(): ContractSourceMetadata {
    return super._contract_source_metadata();
  }
}