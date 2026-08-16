const { SPECIAL } = require("./specials");

module.exports = [
  {
    id: "hall_of_levers",
    name: "Sala delle Leve",
    width: 9,
    height: 9,
    grid: [
      [1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,0,1],
      [1,0,1,0,0,0,1,0,1],
      [1,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,1],
      [1,0,1,0,0,0,1,0,1],
      [1,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,1],
      [1,1,1,1,2,1,1,1,1]
    ],
    entities: [
      { type: SPECIAL.LEVER, x: 2, y: 1, puzzleId: "lever_a", state: "down" },
      { type: SPECIAL.LEVER, x: 3, y: 1, puzzleId: "lever_b", state: "up" },
      { type: SPECIAL.LEVER, x: 4, y: 1, puzzleId: "lever_c", state: "down" },
      { type: SPECIAL.LEVER, x: 5, y: 1, puzzleId: "lever_d", state: "down" },
      { type: SPECIAL.LECTERN, x: 1, y: 7, textId: "indizio_leve_sewer", title: "Pergamena" },
      { type: SPECIAL.PEDESTAL, x: 7, y: 1, puzzleId: "pedestal_mirror", requiredItem: "mirror" },
      { type: SPECIAL.DOOR_PUZZLE, x: 4, y: 8, puzzleId: "reward_door", orientation: "horizontal" }
    ],
    solution: {
      type: "lever_sequence",
      required: ["lever_b", "lever_a", "lever_c", "lever_d"]
    }
  }
];
