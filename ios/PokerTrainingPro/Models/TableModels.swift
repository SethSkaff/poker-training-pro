import Foundation

struct PokerCard: Codable, Equatable, Sendable, Identifiable {
    let rank: String
    let suit: String

    var id: String { "\(rank):\(suit)" }

    var symbol: String {
        switch suit {
        case "clubs": "♣"
        case "diamonds": "♦"
        case "hearts": "♥"
        case "spades": "♠"
        default: "?"
        }
    }

    var isRed: Bool {
        suit == "diamonds" || suit == "hearts"
    }
}

struct DealPreview: Equatable, Sendable {
    let hero: [PokerCard]
    let board: [PokerCard]

    static let placeholder = DealPreview(
        hero: [
            PokerCard(rank: "A", suit: "spades"),
            PokerCard(rank: "K", suit: "hearts"),
        ],
        board: [
            PokerCard(rank: "T", suit: "clubs"),
            PokerCard(rank: "7", suit: "diamonds"),
            PokerCard(rank: "2", suit: "spades"),
        ]
    )
}

