import Foundation
import JavaScriptCore

@MainActor
protocol PokerEngineClient {
    func invoke(_ request: EngineRequest) throws -> EngineResponse
    func dealPreview(seed: String) throws -> DealPreview
}

@MainActor
final class SharedPokerEngineBridge: PokerEngineClient {
    private let context: JSContext
    private var latestException: String?

    convenience init(bundle: Bundle = .main) throws {
        let scriptURL =
            bundle.url(forResource: "poker-engine", withExtension: "js", subdirectory: "Engine")
            ?? bundle.url(forResource: "poker-engine", withExtension: "js")

        guard let scriptURL else {
            throw EngineBridgeError.resourceMissing
        }
        try self.init(scriptURL: scriptURL)
    }

    init(scriptURL: URL) throws {
        guard
            let context = JSContext(),
            let source = try? String(contentsOf: scriptURL, encoding: .utf8)
        else {
            throw EngineBridgeError.scriptUnreadable
        }

        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.latestException = exception?.toString() ?? "Unknown JavaScript exception"
        }
        context.evaluateScript(source, withSourceURL: scriptURL)

        if let latestException {
            throw EngineBridgeError.scriptException(latestException)
        }

        guard
            let global = context.objectForKeyedSubscript("PokerTrainingEngine"),
            !global.isUndefined,
            !global.isNull
        else {
            throw EngineBridgeError.globalMissing
        }
    }

    func invoke(_ request: EngineRequest) throws -> EngineResponse {
        latestException = nil

        let requestData = try JSONEncoder().encode(request)
        guard let requestJSON = String(data: requestData, encoding: .utf8) else {
            throw EngineBridgeError.invalidResponse
        }

        guard
            let global = context.objectForKeyedSubscript("PokerTrainingEngine"),
            let value = global.invokeMethod("invoke", withArguments: [requestJSON])
        else {
            throw EngineBridgeError.emptyResponse
        }

        if let latestException {
            throw EngineBridgeError.scriptException(latestException)
        }

        guard
            let responseJSON = value.toString(),
            let responseData = responseJSON.data(using: .utf8),
            let response = try? JSONDecoder().decode(EngineResponse.self, from: responseData)
        else {
            throw EngineBridgeError.invalidResponse
        }

        guard response.contractVersion == EngineContract.version else {
            throw EngineBridgeError.contractMismatch(
                expected: EngineContract.version,
                actual: response.contractVersion
            )
        }

        guard response.ok else {
            throw EngineBridgeError.requestFailed(
                code: response.error?.code ?? "UNKNOWN",
                message: response.error?.message ?? "Unknown engine failure"
            )
        }

        return response
    }

    func dealPreview(seed: String) throws -> DealPreview {
        let response = try invoke(EngineRequest(operation: "dealPreview", seed: seed))
        guard
            let result = response.result,
            let heroValues = result["hero"]?.arrayValue,
            let boardValues = result["board"]?.arrayValue
        else {
            throw EngineBridgeError.malformedDeal
        }

        func decodeCards(_ values: [JSONValue]) -> [PokerCard]? {
            var cards: [PokerCard] = []
            for value in values {
                guard
                    let object = value.objectValue,
                    let rank = object["rank"]?.stringValue,
                    let suit = object["suit"]?.stringValue
                else {
                    return nil
                }
                cards.append(PokerCard(rank: rank, suit: suit))
            }
            return cards
        }

        guard
            let hero = decodeCards(heroValues),
            let board = decodeCards(boardValues),
            hero.count == 2,
            board.count == 3
        else {
            throw EngineBridgeError.malformedDeal
        }

        return DealPreview(hero: hero, board: board)
    }
}
