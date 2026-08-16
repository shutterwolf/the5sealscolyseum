const { SPECIAL } = require("./specials");

class PuzzleRoomInjector {
  inject(levelData, templates) {
    const candidates = levelData.rooms.filter(r => {
      const w = r.getRight() - r.getLeft() + 1;
      const h = r.getBottom() - r.getTop() + 1;
      return w >= 9 && h >= 9;
    });

    if (candidates.length === 0) return null;

    const room = candidates[Math.floor(ROT.RNG.getUniform() * candidates.length)];
    const tpl = templates[Math.floor(ROT.RNG.getUniform() * templates.length)];

    const roomW = room.getRight() - room.getLeft() + 1;
    const roomH = room.getBottom() - room.getTop() + 1;
    const offX = room.getLeft() + Math.floor((roomW - tpl.width) / 2);
    const offY = room.getTop() + Math.floor((roomH - tpl.height) / 2);

    for (let y = 0; y < tpl.height; y++) {
      for (let x = 0; x < tpl.width; x++) {
        const mapX = offX + x;
        const mapY = offY + y;
        const key = `${mapX},${mapY}`;
        const v = tpl.grid[y][x];
        if (v === 0) levelData.map[key] = ".";
        else if (v === 1) levelData.map[key] = "#";
        else if (v === 2) levelData.map[key] = ".";
      }
    }

    room.getDoors((dx, dy) => {
      levelData.map[`${dx},${dy}`] = ".";
    });

    const puzzleState = {
      templateId: tpl.id,
      solved: false,
      entities: {},
      solution: tpl.solution
    };

    for (const ent of tpl.entities) {
      const wx = offX + ent.x;
      const wy = offY + ent.y;
      const key = `${wx},${wy}`;

      if (ent.type === SPECIAL.DOOR_PUZZLE) {
        if (!levelData.doors) levelData.doors = {};
        levelData.doors[key] = {
          x: wx,
          y: wy,
          closed: true,
          state: "closed",
          lockType: "puzzle",
          puzzleId: ent.puzzleId,
          orientation: ent.orientation || "horizontal",
          material: "stone"
        };
      } else {
        puzzleState.entities[key] = {
          type: ent.type,
          x: wx,
          y: wy,
          puzzleId: ent.puzzleId,
          state: ent.state || "default",
          active: ent.active || false,
          textId: ent.textId || null,
          title: ent.title || null,
          requiredItem: ent.requiredItem || null,
          placedItem: null
        };

        if (!levelData.furnitures) levelData.furnitures = {};
        levelData.furnitures[key] = {
          x: wx,
          y: wy,
          type: ent.type,
          rotation: 0,
          puzzleId: ent.puzzleId,
          interactable: true
        };
      }
    }

    return { puzzleState, room };
  }
}

module.exports = { PuzzleRoomInjector };
