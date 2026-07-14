import Foundation

public enum HeartRateParserError: Error, Equatable {
    case tooShort
    case invalidValue(Int)
}

public enum HeartRateParser {
    public static func parse(_ data: Data) throws -> Int {
        guard data.count >= 2 else { throw HeartRateParserError.tooShort }

        let bytes = [UInt8](data)
        let is16Bit = bytes[0] & 0x01 != 0
        let bpm: Int

        if is16Bit {
            guard bytes.count >= 3 else { throw HeartRateParserError.tooShort }
            bpm = Int(bytes[1]) | Int(bytes[2]) << 8
        } else {
            bpm = Int(bytes[1])
        }

        guard (1...300).contains(bpm) else {
            throw HeartRateParserError.invalidValue(bpm)
        }
        return bpm
    }
}
