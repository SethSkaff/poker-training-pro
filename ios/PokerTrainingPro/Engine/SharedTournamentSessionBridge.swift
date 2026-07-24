import Foundation
import JavaScriptCore

/// Local-only adapter for the generated desktop tournament-runner bundle.
/// Requests and responses remain JSON so Swift never reimplements betting,
/// side pots, blind changes, or bot policy.
@MainActor
final class SharedTournamentSessionBridge {
    private let context: JSContext
    private var latestException: String?

    convenience init(bundle: Bundle = .main) throws {
        let scriptURL = bundle.url(forResource: "tournament-session-engine", withExtension: "js", subdirectory: "Engine")
            ?? bundle.url(forResource: "tournament-session-engine", withExtension: "js")
        guard let scriptURL else { throw EngineBridgeError.resourceMissing }
        try self.init(scriptURL: scriptURL)
    }

    init(scriptURL: URL) throws {
        guard let context = JSContext(), let source = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            throw EngineBridgeError.scriptUnreadable
        }
        self.context = context
        context.exceptionHandler = { [weak self] _, exception in
            self?.latestException = exception?.toString() ?? "Unknown JavaScript exception"
        }
        context.evaluateScript(source, withSourceURL: scriptURL)
        if let latestException { throw EngineBridgeError.scriptException(latestException) }
        guard let global = context.objectForKeyedSubscript("PokerTrainingProTournamentEngine"), !global.isUndefined, !global.isNull else {
            throw EngineBridgeError.globalMissing
        }
    }

    func invoke<Response: Decodable>(operation: String, payload: [String: JSONValue], as type: Response.Type) throws -> Response {
        latestException = nil
        let requestData = try JSONEncoder().encode(["operation": operation, "payload": payload])
        guard let request = String(data: requestData, encoding: .utf8),
              // JSONSerialization only accepts array/dictionary top-level values
              // on every supported Foundation runtime. JSONEncoder is defined for
              // a top-level String, and gives us a correctly escaped JavaScript
              // string literal for JSON.parse below.
              let literalData = try? JSONEncoder().encode(request),
              let literal = String(data: literalData, encoding: .utf8),
              let value = context.evaluateScript("PokerTrainingProTournamentEngine.invoke(JSON.parse(\(literal)))")
        else { throw EngineBridgeError.invalidResponse }
        if let latestException { throw EngineBridgeError.scriptException(latestException) }
        guard let object = value.toObject(), JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object)
        else { throw EngineBridgeError.invalidResponse }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    func createTournament(
        kind: String,
        eventID: String = "local-qualifier",
        mode: String,
        minutes: Int? = nil,
        seed: String,
        nowMs: Int,
        heroID: String,
        heroName: String,
        heroRating: Int,
        careerResults: [MobileCareerResult] = []
    ) throws -> MobileTournamentSessionResponse {
        var payload: [String: JSONValue] = [
            "kind": .string(kind), "eventId": .string(eventID),
            "mode": .string(mode), "seed": .string(seed), "nowMs": .init(nowMs),
            "hero": .object(["id": .string(heroID), "name": .string(heroName), "rating": .init(heroRating)]),
        ]
        if let minutes { payload["minutes"] = .init(minutes) }
        if !careerResults.isEmpty {
            payload["careerResults"] = .array(careerResults.map { result in
                .object([
                    "eventId": .string(result.eventId),
                    "finishPlace": .init(result.finishPlace),
                    "fieldSize": .init(result.fieldSize),
                    "sourceFieldSize": .init(result.sourceFieldSize),
                    "qualifyingPlaces": .init(result.qualifyingPlaces),
                    "qualified": .bool(result.qualified),
                    "tournamentEloDelta": .init(result.tournamentEloDelta),
                ])
            })
        }
        return try invoke(operation: "createTournament", payload: payload, as: MobileTournamentSessionResponse.self)
    }

    func actTournament(
        replay: JSONValue,
        action: String,
        raiseTo: Int? = nil,
        nowMs: Int,
        decisionElapsedMs: Int
    ) throws -> MobileTournamentSessionResponse {
        var payload: [String: JSONValue] = [
            "replay": replay, "action": .string(action), "nowMs": .init(nowMs),
            "decisionElapsedMs": .init(decisionElapsedMs),
        ]
        if let raiseTo { payload["raiseTo"] = .init(raiseTo) }
        return try invoke(operation: "actTournament", payload: payload, as: MobileTournamentSessionResponse.self)
    }
}
