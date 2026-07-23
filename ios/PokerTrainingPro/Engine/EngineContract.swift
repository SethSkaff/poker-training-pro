import Foundation

enum EngineContract {
    static let version = "1.0.0"
}

struct EngineRequest: Codable, Equatable, Sendable {
    let contractVersion: String
    let requestID: String
    let operation: String
    let seed: String?
    let payload: [String: JSONValue]

    init(
        requestID: String = UUID().uuidString,
        operation: String,
        seed: String? = nil,
        payload: [String: JSONValue] = [:]
    ) {
        contractVersion = EngineContract.version
        self.requestID = requestID
        self.operation = operation
        self.seed = seed
        self.payload = payload
    }
}

struct EngineFailure: Codable, Equatable, Sendable {
    let code: String
    let message: String
}

struct EngineResponse: Codable, Equatable, Sendable {
    let contractVersion: String
    let requestID: String
    let ok: Bool
    let result: [String: JSONValue]?
    let error: EngineFailure?
}

enum EngineBridgeError: LocalizedError, Equatable {
    case resourceMissing
    case scriptUnreadable
    case scriptException(String)
    case globalMissing
    case emptyResponse
    case invalidResponse
    case contractMismatch(expected: String, actual: String)
    case requestFailed(code: String, message: String)
    case malformedDeal

    var errorDescription: String? {
        switch self {
        case .resourceMissing:
            "The bundled poker engine resource is missing."
        case .scriptUnreadable:
            "The bundled poker engine could not be read."
        case let .scriptException(message):
            "The bundled poker engine raised an exception: \(message)"
        case .globalMissing:
            "The bundled poker engine does not expose PokerTrainingEngine."
        case .emptyResponse:
            "The bundled poker engine returned no response."
        case .invalidResponse:
            "The bundled poker engine returned invalid JSON."
        case let .contractMismatch(expected, actual):
            "Engine contract mismatch. Expected \(expected), received \(actual)."
        case let .requestFailed(code, message):
            "Engine request failed (\(code)): \(message)"
        case .malformedDeal:
            "The engine returned an invalid deal preview."
        }
    }
}

