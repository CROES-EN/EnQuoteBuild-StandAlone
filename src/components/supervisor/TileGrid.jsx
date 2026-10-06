import {DragDropContext, Draggable, Droppable} from "@hello-pangea/dnd";

/**
 * Drag-and-drop grid for the Executive Overview's unified tile system. Each
 * tile is a plain { id, render } descriptor (see DashboardOverview.jsx's
 * "allTiles" registry) - this component only handles layout and reordering,
 * it never computes any tile's actual value. Uses @hello-pangea/dnd, already
 * an existing project dependency - no new package required.
 *
 * The entire tile card is the drag handle (grab anywhere on a tile to move
 * it) - clicks on buttons/links inside a tile (e.g. "View contributing
 * records") still work normally, since the underlying library only treats a
 * press-and-move as a drag, not a plain click.
 */
export default function TileGrid({ tiles, onReorder }) {
  function handleDragEnd(result) {
    if (!result.destination || result.destination.index === result.source.index) return;
    const reordered = Array.from(tiles);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    onReorder(reordered.map((t) => t.id));
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="executive-overview-tiles">
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {tiles.map((tile, index) => (
              <Draggable key={tile.id} draggableId={tile.id} index={index}>
                {(dragProvided, dragSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    className={`min-w-0 cursor-grab rounded-xl transition-shadow active:cursor-grabbing [&>div]:h-full ${dragSnapshot.isDragging ? "shadow-lg ring-2 ring-primary/40" : ""}`}
                  >
                    {tile.render()}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}