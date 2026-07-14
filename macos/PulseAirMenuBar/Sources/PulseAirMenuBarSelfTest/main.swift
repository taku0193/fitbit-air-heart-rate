import Foundation
import PulseAirCore

private enum SelfTestFailure: Error, CustomStringConvertible {
    case failed(String)

    var description: String {
        switch self {
        case .failed(let message): return message
        }
    }
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw SelfTestFailure.failed(message) }
}

private func expectError(_ expected: HeartRateParserError, data: Data, _ message: String) throws {
    do {
        _ = try HeartRateParser.parse(data)
        throw SelfTestFailure.failed(message)
    } catch let error as HeartRateParserError {
        try expect(error == expected, message)
    }
}

do {
    try expect(HeartRateParser.parse(Data([0x00, 72])) == 72, "8bit心拍数の解析に失敗")
    try expect(HeartRateParser.parse(Data([0x01, 0x04, 0x01])) == 260, "16bit心拍数の解析に失敗")
    try expectError(.tooShort, data: Data(), "空データを拒否できませんでした")
    try expectError(.tooShort, data: Data([0x01, 72]), "短い16bitデータを拒否できませんでした")
    try expectError(.invalidValue(0), data: Data([0x00, 0]), "不正な心拍数を拒否できませんでした")
    print("PulseAirCore: 5 checks passed")
} catch {
    fputs("PulseAirCore self-test failed: \(error)\n", stderr)
    exit(1)
}
