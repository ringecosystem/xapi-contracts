import { near } from "near-sdk-js";

export class Standard {
    standard: string;
    version: string;
    constructor(standard: string, version: string) {
        this.standard = standard;
        this.version = version;
    }
}

export abstract class NearEvent {

    private internal_to_json_string(): string {
        return JSON.stringify(this);
    }

    private internal_to_json_event_string(): string {
        return `EVENT_JSON: ${this.internal_to_json_string()}`;
    }

    /**
     * Logs the event to the host. This is required to ensure that the event is triggered
     * and to consume the event.
     */
    emit(): void {
        near.log(this.internal_to_json_event_string());
    }
}

// nep297 <https://github.com/near/NEPs/blob/master/neps/nep-0297.md>
export class Nep297Event extends NearEvent {
    standard: string;
    version: string;
    event: string;
    data: any;
    constructor(event: string, data: any) {
        super();
        this.standard = "nep297";
        this.version = "1.0.0";
        this.event = event;
        this.data = data;
    }
}

// nep330 <https://github.com/near/NEPs/blob/master/neps/nep-0330.md>
export class ContractSourceMetadata {
    version: string | null;
    link: string | null;
    standards: Standard[] | null;
    constructor(version: string | null, link: string | null, standards: Standard[]) {
        this.version = version;
        this.link = link;
        this.standards = standards;
    }
}

export abstract class ContractBase {
    contract_metadata: ContractSourceMetadata;

    constructor(contract_metadata: ContractSourceMetadata) {
        this.contract_metadata = contract_metadata;
    }

    abstract contract_source_metadata(): ContractSourceMetadata;

    _contract_source_metadata(): ContractSourceMetadata {
        return this.contract_metadata;
    }
}