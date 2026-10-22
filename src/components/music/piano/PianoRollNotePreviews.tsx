import React, { useSyncExternalStore, useMemo } from "react";
import { StyledPianoRollNote } from "components/music/piano/style";
import { useAppSelector } from "store/hooks";
import { PIANO_ROLL_CELL_SIZE, TRACKER_PATTERN_LENGTH } from "consts";
import { toAbsRow } from "store/features/trackerDocument/trackerDocumentHelpers";
import { wrapNote } from "shared/lib/uge/display";
import { noteToRow } from "components/music/piano/helpers";
import { NO_CHANGE_ON_PASTE } from "shared/lib/uge/clipboard";

type DragPreviewSnapshot = {
  rowDelta: number;
  noteDelta: number;
};

export const createNoteDragPreviewStore = () => {
  let snapshot: DragPreviewSnapshot = {
    rowDelta: 0,
    noteDelta: 0,
  };

  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot: (next: DragPreviewSnapshot) => {
      if (
        next.rowDelta === snapshot.rowDelta &&
        next.noteDelta === snapshot.noteDelta
      ) {
        return;
      }

      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    reset: () => {
      if (snapshot.rowDelta === 0 && snapshot.noteDelta === 0) {
        return;
      }

      snapshot = { rowDelta: 0, noteDelta: 0 };
      listeners.forEach((listener) => listener());
    },
  };
};

export const DragPreviewNotes = React.memo(
  ({
    dragPreviewStore,
  }: {
    dragPreviewStore: {
      getSnapshot: () => { rowDelta: number; noteDelta: number };
      subscribe: (listener: () => void) => () => void;
    };
  }) => {
    const { rowDelta, noteDelta } = useSyncExternalStore(
      dragPreviewStore.subscribe,
      dragPreviewStore.getSnapshot,
      dragPreviewStore.getSnapshot,
    );

    const sequence = useAppSelector(
      (state) => state.trackerDocument.present.song?.sequence,
    );
    const patterns = useAppSelector(
      (state) => state.trackerDocument.present.song?.patterns,
    );
    const selectedPatternCells = useAppSelector(
      (state) => state.tracker.selectedPatternCells,
    );
    const sequenceLength = useAppSelector(
      (state) => state.trackerDocument.present.song?.sequence?.length ?? 0,
    );

    const totalAbsRows = sequenceLength * TRACKER_PATTERN_LENGTH;

    const previewNotes = useMemo(() => {
      if (!sequence || !patterns) {
        return [];
      }

      return selectedPatternCells
        .map((sourceCellAddress) => {
          const sourcePatternId =
            sequence[sourceCellAddress.sequenceId]?.channels[
              sourceCellAddress.channelId
            ];
          if (sourcePatternId === undefined) {
            return null;
          }

          const sourceCell =
            patterns[sourcePatternId]?.[sourceCellAddress.rowId];

          if (!sourceCell || sourceCell.note === null) {
            return null;
          }

          const sourceAbsRow = toAbsRow(
            sourceCellAddress.sequenceId,
            sourceCellAddress.rowId,
          );
          const targetAbsRow = sourceAbsRow + rowDelta;

          if (targetAbsRow < 0 || targetAbsRow >= totalAbsRows) {
            return null;
          }

          const targetNote = wrapNote(sourceCell.note + noteDelta);
          const targetRow = noteToRow(targetNote);

          return {
            key: `${sourceCellAddress.sequenceId}:${sourceCellAddress.rowId}:${sourceCellAddress.channelId}`,
            left: targetAbsRow * PIANO_ROLL_CELL_SIZE,
            top: targetRow * PIANO_ROLL_CELL_SIZE,
            instrument: sourceCell.instrument ?? 0,
          };
        })
        .filter(
          (
            note,
          ): note is {
            key: string;
            left: number;
            top: number;
            instrument: number;
          } => note !== null,
        );
    }, [
      noteDelta,
      patterns,
      rowDelta,
      selectedPatternCells,
      sequence,
      totalAbsRows,
    ]);

    return previewNotes.map((previewNote) => (
      <StyledPianoRollNote
        key={`preview_${previewNote.key}`}
        $isSelected
        $instrument={previewNote.instrument}
        style={{
          left: previewNote.left,
          top: previewNote.top,
          zIndex: 2,
        }}
      />
    ));
  },
);

export const PastePreviewNotes = () => {
  const pastedPattern = useAppSelector((state) => state.tracker.pastedPattern);

  const sequenceLength = useAppSelector(
    (state) => state.trackerDocument.present.song?.sequence?.length ?? 0,
  );

  const totalAbsRows = sequenceLength * TRACKER_PATTERN_LENGTH;

  const hoverNote = useAppSelector((state) => state.tracker.hoverNote);
  const hoverColumn = useAppSelector((state) => state.tracker.hoverColumn);
  const hoverSequenceId = useAppSelector(
    (state) => state.tracker.hoverSequence,
  );

  const pastePreviewNotes = useMemo(() => {
    if (
      !pastedPattern ||
      hoverColumn === null ||
      hoverNote === null ||
      hoverSequenceId === null
    ) {
      return [];
    }
    const hoverAbsRow = hoverSequenceId * TRACKER_PATTERN_LENGTH + hoverColumn;
    let noteOffset: number | undefined = undefined;
    const notes: {
      key: string;
      left: number;
      top: number;
      instrument: number;
    }[] = [];
    for (let offset = 0; offset < pastedPattern.length; offset++) {
      const cell = pastedPattern[offset][0];
      if (cell.note === null || cell.note === NO_CHANGE_ON_PASTE) continue;
      if (noteOffset === undefined) noteOffset = hoverNote - cell.note;
      const targetAbsRow = hoverAbsRow + offset;
      if (targetAbsRow < 0 || targetAbsRow >= totalAbsRows) continue;
      const targetNote = wrapNote(cell.note + noteOffset);
      const targetRow = noteToRow(targetNote);
      notes.push({
        key: `${offset}`,
        left: targetAbsRow * PIANO_ROLL_CELL_SIZE,
        top: targetRow * PIANO_ROLL_CELL_SIZE,
        instrument: cell.instrument ?? 0,
      });
    }
    return notes;
  }, [hoverColumn, hoverNote, hoverSequenceId, pastedPattern, totalAbsRows]);

  if (!pastedPattern || pastePreviewNotes.length === 0) {
    return null;
  }

  return pastePreviewNotes.map((previewNote) => (
    <StyledPianoRollNote
      key={`paste_preview_${previewNote.key}`}
      $isSelected
      $instrument={previewNote.instrument}
      style={{
        left: previewNote.left,
        top: previewNote.top,
        zIndex: 2,
      }}
    />
  ));
};
