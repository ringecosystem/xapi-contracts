import { near } from "near-sdk-js";

export class Standard {
    standard: string;
    version: string;
    constructor(standard: string, version: string) {
        this.standard = standard;
        this.version = version;
    }
}

// nep297 <https://github.com/near/NEPs/blob/master/neps/nep-0297.md>
// todo use  <https://github.com/near/near-sdk-js/blob/v1.0.0-0/packages/near-contract-standards/src/event.ts>
export class EventLog extends Standard {
    event: string;
    data: any;
    constructor(event: string, data: any) {
        super("nep297", "1.0.0");
        this.event = event;
        this.data = data;
    }
}

// nep330 <https://github.com/near/NEPs/blob/master/neps/nep-0330.md>
export class ContractSourceMetadata {
    version: string | null;
    link: string | null;
    standards: Standard[];
    constructor(version: string | null, link: string | null, standards: Standard[]) {
        this.version = version;
        this.link = link;
        this.standards = standards;
    }
}

export class ContractBase {
    contract_metadata: ContractSourceMetadata;

    emit(event: string, data: any) {
        near.log(JSON.stringify(new EventLog(event, data)));
    }

    contract_source_metadata(): ContractSourceMetadata {
        return this.contract_metadata;
    }
}