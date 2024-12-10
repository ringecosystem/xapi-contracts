import { near } from "near-sdk-js";

export function sizeOf(obj: any) {
    let _bytes = 0;
    if (obj !== null && obj !== undefined) {
        switch (typeof obj) {
            case "number":
                _bytes += 8;
                break;
            case "string":
                _bytes += obj.length * 2;
                break;
            case "boolean":
                _bytes += 4;
                break;
            case "object":
                const _objClass = Object.prototype.toString.call(obj).slice(8, -1);
                if (_objClass === "Object" || _objClass === "Array") {
                    for (let _key in obj) {
                        if (!obj.hasOwnProperty(_key)) continue;
                        _bytes += sizeOf(obj[_key]);
                    }
                } else {
                    _bytes += obj.toString().length * 2;
                }
                break;
        }
    }
    // near.log(`bytes: ${_bytes}, value: ${JSON.stringify(obj)}`);
    return _bytes;
}

export function concatSignature(r: string, s: string, v: number): string {
    return '0x' + r.substring(2) + s + (v + 27).toString(16).padStart(2, '0');
}