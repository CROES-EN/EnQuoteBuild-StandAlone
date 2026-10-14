import {DragDropContext, Draggable, Droppable} from "@hello-pangea/dnd";

const FRESHNESS_DOT = {live: "bg-sky-500", fresh: "bg-emerald-500", stale: "bg-amber-500", missing: "bg-muted-foreground/50"};

// Where a tile's number comes from and how current it is; stale = older than the prior business day.
function FreshnessLine({ freshness }) {
  if (!freshness) return null;
  return (
    <p data-tile-freshness={freshness.tone} title={freshness.stale ? "Older than the prior business day - reimport or refresh before relying on this number." : freshness.text}
      className={`flex items-center gap-1.5 px-1 text-[11px] ${freshness.stale ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${FRESHNESS_DOT[freshness.tone] || FRESHNESS_DOT.missing}`} />
      <span className="truncate">{freshness.stale && freshness.tone !== "missing" ? "Stale · " : ""}{freshness.text}</span>
    </p>
  );
}

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
export default function TileGrid({ tiles, onReorder, sharePath, freshnessFor }) {
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
                    data-enquote-share-target={`supervisor-tile:${tile.id}`}
                    data-enquote-share-label={tile.label}
                    data-enquote-share-route={sharePath?.(tile.id)}
                    className={`min-w-0 cursor-grab rounded-xl transition-shadow active:cursor-grabbing [&>div]:h-full ${dragSnapshot.isDragging ? "shadow-lg ring-2 ring-primary/40" : ""}`}
                  >
                    <div className="flex h-full flex-col gap-1">
                      <div className="min-h-0 flex-1 [&>div]:h-full">{tile.render()}</div>
                      <FreshnessLine freshness={freshnessFor?.(tile.id)} />
                    </div>
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