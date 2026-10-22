import React, { memo, useRef, useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "store/hooks";
import {
  PIANO_ROLL_PIANO_WIDTH,
  PIANO_ROLL_CELL_SIZE,
  TRACKER_PATTERN_LENGTH,
} from "consts";
import {
  StyledPianoRollScrollHeaderFooterSpacer,
  StyledPianoRollScrollTopWrapper,
  StyledPianoRollSequenceHeader,
  StyledPianoRollSequenceHeaderPattern,
  StyledPianoRollSequenceHeaderOrder,
  StyledPianoRollSequenceHeaderText,
  StyledPianoRollPlayhead,
  StyledPianoRollSequenceHeaderTimeMarker,
} from "./style";
import clamp from "shared/lib/helpers/clamp";
import trackerActions from "store/features/tracker/trackerActions";
import {
  calculateDocumentWidth,
  calculatePlaybackTrackerPosition,
} from "./helpers";
import API from "renderer/lib/api";
import type { MusicPosition } from "shared/lib/music/types";
import l10n from "shared/lib/lang/l10n";
import { useContextMenu } from "ui/hooks/use-context-menu";
import renderSequenceItemContextMenu from "components/music/contextMenus/renderSequenceItemContextMenu";
import { DropdownButton } from "ui/buttons/DropdownButton";
import {
  fromAbsRow,
  getPatternBlockCount,
} from "store/features/trackerDocument/trackerDocumentHelpers";
import {
  patternBlockIndex,
  patternGradient,
  patternIndexLabel,
} from "shared/lib/uge/display";
import { SequenceItem } from "shared/lib/uge/types";

interface PianoRollSequenceBarProps {
  children?: React.ReactNode;
}

interface PianoRollSequenceBarPatternProps {
  sequenceItem: SequenceItem;
  patternIndex: number;
  orderIndex: number;
  orderLength: number;
  numPatterns: number;
  globalSplitPattern: boolean;
  loopSequenceId: number | undefined;
}

const tickMarkers = [8, 16, 24, 32, 40, 48, 56] as const;

const PianoRollSequenceBarPattern = memo(
  ({
    patternIndex,
    orderIndex,
    orderLength,
    numPatterns,
    loopSequenceId,
    sequenceItem,
    globalSplitPattern,
  }: PianoRollSequenceBarPatternProps) => {
    const dispatch = useAppDispatch();

    const getContextMenu = useCallback(
      (onClose?: () => void) => {
        return renderSequenceItemContextMenu({
          dispatch,
          sequenceItem,
          orderIndex,
          orderLength,
          numPatterns,
          globalSplitPattern,
          loopSequenceId,
          onClose,
        });
      },
      [
        dispatch,
        sequenceItem,
        orderIndex,
        orderLength,
        numPatterns,
        globalSplitPattern,
        loopSequenceId,
      ],
    );

    const { onContextMenu, contextMenuElement } = useContextMenu({
      getMenu: ({ closeMenu }) => getContextMenu(closeMenu),
    });

    const contextMenu = useMemo(() => getContextMenu(), [getContextMenu]);

    const isFiltered =
      loopSequenceId !== undefined && loopSequenceId !== orderIndex;

    const patternId = patternBlockIndex(patternIndex);
    const splitPattern = globalSplitPattern || sequenceItem.splitPattern;

    return (
      <StyledPianoRollSequenceHeaderPattern
        onContextMenu={onContextMenu}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ background: patternGradient(patternId, isFiltered) }}
      >
        <StyledPianoRollSequenceHeaderText>
          <DropdownButton
            variant="transparent"
            label={`${orderIndex + 1}: ${l10n("FIELD_PATTERN")} ${patternIndexLabel(patternIndex, splitPattern)}`}
          >
            {contextMenu}
          </DropdownButton>
        </StyledPianoRollSequenceHeaderText>
        {contextMenuElement}
      </StyledPianoRollSequenceHeaderPattern>
    );
  },
);

export const PianoRollSequenceBar = memo(
  ({ children }: PianoRollSequenceBarProps) => {
    const dispatch = useAppDispatch();

    const songSequence = useAppSelector(
      (state) => state.trackerDocument.present.song?.sequence,
    );
    const sequenceLength = useAppSelector(
      (state) => state.trackerDocument.present.song?.sequence?.length ?? 0,
    );
    const numPatterns = useAppSelector((state) =>
      getPatternBlockCount(state.trackerDocument.present.song?.patterns),
    );
    const loopSequenceId = useAppSelector(
      (state) => state.tracker.loopSequenceId,
    );
    const selectedChannel = useAppSelector(
      (state) => state.tracker.selectedChannel,
    );
    const globalSplitPattern = useAppSelector(
      (state) => state.tracker.globalSplitPattern,
    );

    const documentWidth = calculateDocumentWidth(sequenceLength);

    const defaultStartPlaybackSequence = useAppSelector(
      (state) => state.tracker.defaultStartPlaybackSequence,
    );
    const defaultStartPlaybackRow = useAppSelector(
      (state) => state.tracker.defaultStartPlaybackRow,
    );

    const headerRef = useRef<HTMLDivElement>(null);
    const lastPositionRef = useRef<MusicPosition | null>(null);

    const setDefaultPlaybackStartPosition = useCallback(
      (sequenceId: number, rowId: number) => {
        const next = { sequence: sequenceId, row: rowId };
        const prev = lastPositionRef.current;

        if (prev && prev.sequence === next.sequence && prev.row === next.row) {
          return;
        }

        lastPositionRef.current = next;

        dispatch(trackerActions.setDefaultStartPlaybackPosition(next));

        API.music.sendToMusicWindow({
          action: "position",
          position: next,
        });
      },
      [dispatch],
    );

    const updatePlaybackPosition = useCallback(
      (e: MouseEvent) => {
        const header = headerRef.current;
        if (!header) {
          return;
        }

        const rect = header.getBoundingClientRect();
        const x = e.clientX - rect.left - PIANO_ROLL_PIANO_WIDTH;

        const totalCols = sequenceLength * TRACKER_PATTERN_LENGTH;

        const absRow = clamp(
          Math.floor(x / PIANO_ROLL_CELL_SIZE),
          0,
          totalCols - 1,
        );

        const { sequenceId, rowId } = fromAbsRow(absRow);

        setDefaultPlaybackStartPosition(sequenceId, rowId);
      },
      [sequenceLength, setDefaultPlaybackStartPosition],
    );

    const onMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        const handleMouseMove = (ev: MouseEvent) => {
          updatePlaybackPosition(ev);
        };

        const handleMouseUp = () => {
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        updatePlaybackPosition(e.nativeEvent);
      },
      [updatePlaybackPosition],
    );

    const defaultPlayheadX = calculatePlaybackTrackerPosition(
      defaultStartPlaybackSequence,
      defaultStartPlaybackRow,
    );

    return (
      <StyledPianoRollScrollTopWrapper
        ref={headerRef}
        style={{ minWidth: PIANO_ROLL_PIANO_WIDTH + documentWidth }}
        onMouseDown={onMouseDown}
      >
        <StyledPianoRollScrollHeaderFooterSpacer />
        {songSequence?.map((sequenceItem, i) => (
          <StyledPianoRollSequenceHeader
            key={`${i}:${sequenceItem.channels.join(",")}`}
          >
            <StyledPianoRollSequenceHeaderOrder>
              {tickMarkers.map((n) => (
                <StyledPianoRollSequenceHeaderTimeMarker key={n}>
                  {n}
                </StyledPianoRollSequenceHeaderTimeMarker>
              ))}
            </StyledPianoRollSequenceHeaderOrder>
            <PianoRollSequenceBarPattern
              sequenceItem={sequenceItem}
              orderIndex={i}
              patternIndex={sequenceItem.channels[selectedChannel]}
              orderLength={sequenceLength}
              numPatterns={numPatterns}
              globalSplitPattern={globalSplitPattern}
              loopSequenceId={loopSequenceId}
            />
          </StyledPianoRollSequenceHeader>
        ))}
        {defaultPlayheadX > 0 && (
          <StyledPianoRollPlayhead
            $isDefaultMarker
            style={{ transform: `translateX(${defaultPlayheadX}px)` }}
          />
        )}
        {children}
      </StyledPianoRollScrollTopWrapper>
    );
  },
);
