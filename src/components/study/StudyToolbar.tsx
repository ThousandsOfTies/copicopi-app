import { StudyToolbarNavigation, type BreadcrumbItem } from '@home-teacher/common/components/study/StudyToolbarNavigation'
import { StudyEraserTool, StudyTextTool, type TextDirection } from '@home-teacher/common/components/study/StudyToolSettings'
import { useStudyToolPopups } from '@home-teacher/common/hooks/useStudyToolPopups'
export type { BreadcrumbItem } from '@home-teacher/common/components/study/StudyToolbarNavigation'
export type { TextDirection } from '@home-teacher/common/components/study/StudyToolSettings'
import { useAppTranslation } from '../../i18n'
import React, { useEffect, useRef, useState } from 'react';
import { FiChevronDown, FiHeart, FiCheckCircle, FiLoader, FiDroplet, FiTarget, FiLock, FiLayers } from 'react-icons/fi';
import { BiBrush, BiHighlight, BiPaint, BiPalette, BiPen, BiPencil, BiSolidCircle } from 'react-icons/bi';
import { MdBalance } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import type { StrokeStyle } from '@thousands-of-ties/drawing-common';

export type BrushType = 'solid' | 'watercolor';
export type { StrokeStyle } from '@thousands-of-ties/drawing-common';
export type TeacherMode = 'kind' | 'balanced' | 'strict';

interface StudyToolbarProps {
    onBack?: () => void;
    breadcrumbs?: BreadcrumbItem[];
    pageViewControlsEnabled: boolean;
    isSplitView: boolean;
    toggleSplitView: () => void;
    activeTab: 'A' | 'B';
    toggleActiveTab: () => void;

    // Grading
    isGrading: boolean;
    startGrading: () => void;
    showTeacherGrade: boolean;
    teacherMode: TeacherMode;
    setTeacherMode: (mode: TeacherMode) => void;
    enabledTeacherModes?: TeacherMode[];

    // Text Tool
    isTextMode: boolean;
    toggleTextMode: () => void;
    textFontSize: number;
    setTextFontSize: (size: number) => void;
    textDirection: TextDirection;
    setTextDirection: (dir: TextDirection) => void;

    // Pen Tool
    isDrawingMode: boolean;
    toggleDrawingMode: () => void;
    penColor: string;
    setPenColor: (color: string) => void;
    penSize: number;
    setPenSize: (size: number) => void;
    brushType: BrushType;
    setBrushType: (type: BrushType) => void;
    watercolorOpacity: number;
    setWatercolorOpacity: (opacity: number) => void;
    strokeStyle: StrokeStyle;
    setStrokeStyle: (style: StrokeStyle) => void;

    // Eraser Tool
    isEraserMode: boolean;
    toggleEraserMode: () => void;
    eraserSize: number;
    setEraserSize: (size: number) => void;

    // Layers
    showLayerControls: boolean;
    isLayerPanelOpen: boolean;
    toggleLayerPanel: () => void;
    activeLayerName: string;
    layerCount: number;

    // Answer panel actions (shown when on answer panel)
    onGrade?: () => void;
    selectedModel?: string;
    setSelectedModel?: (model: string) => void;
    availableModels?: Array<{ id: string; name: string; description?: string }>;
    defaultModelName?: string;
}

export const StudyToolbar: React.FC<StudyToolbarProps> = ({
    onBack,
    breadcrumbs,
    pageViewControlsEnabled,
    isSplitView,
    toggleSplitView,
    activeTab,
    toggleActiveTab,
    isGrading,
    startGrading,
    showTeacherGrade,
    teacherMode,
    setTeacherMode,
    enabledTeacherModes = ['kind', 'balanced', 'strict'],
    isTextMode,
    toggleTextMode,
    textFontSize,
    setTextFontSize,
    textDirection,
    setTextDirection,
    isDrawingMode,
    toggleDrawingMode,
    penColor,
    setPenColor,
    penSize,
    setPenSize,
    brushType,
    setBrushType,
    watercolorOpacity,
    setWatercolorOpacity,
    strokeStyle,
    setStrokeStyle,
    isEraserMode,
    toggleEraserMode,
    eraserSize,
    setEraserSize,
    showLayerControls,
    isLayerPanelOpen,
    toggleLayerPanel,
    activeLayerName,
    layerCount,
    onGrade,
    selectedModel,
    setSelectedModel,
    availableModels,
    defaultModelName,
}) => {
    const { t } = useTranslation();
    const { t: appT } = useAppTranslation()
    // Popups visibility state
    const [showTeacherMenu, setShowTeacherMenu] = useState(false);
    const teacherMenuRef = useRef<HTMLDivElement>(null);
    const colorPresets = [
        '#000000', '#4b5563', '#9ca3af', '#ffffff', '#7f1d1d', '#dc2626', '#fb7185', '#fda4af',
        '#7c2d12', '#ea580c', '#fb923c', '#fed7aa', '#854d0e', '#eab308', '#fde047', '#fef3c7',
        '#14532d', '#16a34a', '#4ade80', '#bbf7d0', '#064e3b', '#14b8a6', '#5eead4', '#ccfbf1',
        '#1e3a8a', '#2563eb', '#60a5fa', '#bfdbfe', '#4c1d95', '#7c3aed', '#a78bfa', '#ddd6fe',
        '#831843', '#db2777', '#f472b6', '#fbcfe8', '#713f12', '#a16207', '#d6a75d', '#f5e6c8'
    ];

    const allTeacherOptions: Array<{ mode: TeacherMode; label: string; description: string; icon: React.ReactNode }> = [
        { mode: 'kind', label: appT('teachers.kind'), description: appT('teachers.kindDescription'), icon: <FiHeart /> },
        { mode: 'balanced', label: appT('teachers.balanced'), description: appT('teachers.balancedDescription'), icon: <MdBalance /> },
        { mode: 'strict', label: appT('teachers.strict'), description: appT('teachers.strictDescription'), icon: <FiTarget /> },
    ];
    const selectedTeacher = allTeacherOptions.find(option => option.mode === teacherMode) || allTeacherOptions[0];
    const penIconOpacity = brushType === 'watercolor' ? Math.max(watercolorOpacity, 0.32) : 1;
    const penIconStyle = {
        color: isDrawingMode ? penColor : 'currentColor',
        opacity: isDrawingMode ? penIconOpacity : 1,
        filter: isDrawingMode && penColor.toLowerCase() === '#ffffff' ? 'drop-shadow(0 0 1px #475569)' : undefined,
    };
    const penIcons: Record<StrokeStyle, React.ReactNode> = {
        pencil: <BiPencil size={21} style={penIconStyle} />,
        marker: <BiHighlight size={21} style={penIconStyle} />,
        brush: <BiBrush size={21} style={penIconStyle} />,
        calligraphy: <BiPen size={21} style={penIconStyle} />,
        crayon: <BiPaint size={21} style={penIconStyle} />,
    };
    const strokeStyleLabels: Record<StrokeStyle, string> = {
        pencil: appT('tools.pencil'),
        marker: appT('tools.marker'),
        brush: appT('tools.brush'),
        calligraphy: appT('tools.calligraphy'),
        crayon: appT('tools.crayon'),
    };
    const activePenIcon = penIcons[strokeStyle];
    const strokeStyleLabel = strokeStyleLabels[strokeStyle];

    useEffect(() => {
        if (!showTeacherMenu) return;
        const closeMenu = (event: MouseEvent) => {
            if (!teacherMenuRef.current?.contains(event.target as Node)) setShowTeacherMenu(false);
        };
        document.addEventListener('mousedown', closeMenu);
        return () => document.removeEventListener('mousedown', closeMenu);
    }, [showTeacherMenu]);

    const {
        showTextPopup, showPenPopup, showEraserPopup,
        handleTextClick, handlePenClick, handleEraserClick,
    } = useStudyToolPopups({
        text: { active: isTextMode, toggle: toggleTextMode },
        pen: { active: isDrawingMode, toggle: toggleDrawingMode },
        eraser: { active: isEraserMode, toggle: toggleEraserMode },
    });

    return (
        <div className="toolbar">
            <StudyToolbarNavigation
                onBack={onBack}
                breadcrumbs={breadcrumbs}
                pageViewControlsEnabled={pageViewControlsEnabled}
                isSplitView={isSplitView}
                toggleSplitView={toggleSplitView}
                activeTab={activeTab}
                toggleActiveTab={toggleActiveTab}
                labels={{
                    home: appT('toolbar.home'),
                    switchPane: appT(isSplitView ? 'toolbar.single' : 'toolbar.switchPane'),
                    splitView: appT(isSplitView ? 'toolbar.swap' : 'toolbar.split'),
                }}
            />

            {/* 右寄せコンテナ */}
            <div className="toolbar-tools">

                <>
                    <div className="divider"></div>

                    {/* 描画ツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handlePenClick}
                            className={isDrawingMode ? 'active' : ''}
                            title={isDrawingMode ? appT('tools.penSettings', { style: strokeStyleLabel, texture: brushType === 'solid' ? appT('tools.solid') : appT('tools.translucent') }) : appT('toolbar.penOff')}
                            aria-label={appT('tools.penLabel', { style: strokeStyleLabel, texture: brushType === 'solid' ? appT('tools.solid') : appT('tools.translucent') })}
                        >
                            <span className={`pen-toolbar-icon ${brushType}`}>{activePenIcon}</span>
                        </button>

                        {/* ペン設定ポップアップ */}
                        {isDrawingMode && showPenPopup && (
                            <div className="tool-popup pen-settings-popup">
                                <div className="popup-row">
                                    <label className="popup-icon-label" title={appT('tools.color')} aria-label={appT('tools.color')}><BiPalette size={21} /></label>
                                    <input
                                        type="color"
                                        aria-label={appT('tools.selectColor')}
                                        value={penColor}
                                        onChange={(e) => setPenColor(e.target.value)}
                                        className="pen-color-picker"
                                    />
                                </div>
                                <div className="color-preset-grid">
                                    {colorPresets.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            className="color-swatch"
                                            aria-label={appT('tools.colorPreset', { color })}
                                            title={color}
                                            onClick={() => setPenColor(color)}
                                            style={{
                                                background: color, border: penColor === color ? '2px solid #111' : '1px solid #d1d5db',
                                                boxShadow: penColor === color ? '0 0 0 2px white' : 'none'
                                            }}
                                        />
                                    ))}
                                </div>
                                <div className="popup-row">
                                    <label className="popup-icon-label" title={appT('tools.texture')} aria-label={appT('tools.texture')}><FiDroplet size={19} /></label>
                                    <div className="pen-option-group">
                                        <button type="button" aria-label={appT('tools.solid')} title={appT('tools.solidHint')} className={brushType === 'solid' ? 'active' : ''} onClick={() => setBrushType('solid')}><BiSolidCircle size={20} style={{ color: penColor, opacity: 1 }} /></button>
                                        <button type="button" aria-label={appT('tools.watercolor')} title={appT('tools.watercolorHint')} className={brushType === 'watercolor' ? 'active' : ''} onClick={() => setBrushType('watercolor')}><FiDroplet size={19} style={{ color: penColor, opacity: Math.max(watercolorOpacity, 0.32) }} /></button>
                                    </div>
                                </div>
                                <div className="popup-row">
                                    <label className="popup-icon-label" title={appT('tools.strokeStyle')} aria-label={appT('tools.strokeStyle')}><BiBrush size={21} /></label>
                                    <div className="pen-option-group">
                                        <button type="button" aria-label={appT('tools.pencil')} title={appT('tools.pencil')} className={strokeStyle === 'pencil' ? 'active' : ''} onClick={() => setStrokeStyle('pencil')}><BiPencil size={20} style={{ color: penColor, opacity: penIconOpacity }} /></button>
                                        <button type="button" aria-label={appT('tools.marker')} title={appT('tools.marker')} className={strokeStyle === 'marker' ? 'active' : ''} onClick={() => setStrokeStyle('marker')}><BiHighlight size={20} style={{ color: penColor, opacity: penIconOpacity }} /></button>
                                        <button type="button" aria-label={appT('tools.brush')} title={appT('tools.brushHint')} className={strokeStyle === 'brush' ? 'active' : ''} onClick={() => setStrokeStyle('brush')}><BiBrush size={20} style={{ color: penColor, opacity: penIconOpacity }} /></button>
                                        <button type="button" aria-label={appT('tools.calligraphy')} title={appT('tools.calligraphyHint')} className={strokeStyle === 'calligraphy' ? 'active' : ''} onClick={() => setStrokeStyle('calligraphy')}><BiPen size={20} style={{ color: penColor, opacity: penIconOpacity }} /></button>
                                        <button type="button" aria-label={appT('tools.crayon')} title={appT('tools.crayonHint')} className={strokeStyle === 'crayon' ? 'active' : ''} onClick={() => setStrokeStyle('crayon')}><BiPaint size={20} style={{ color: penColor, opacity: penIconOpacity }} /></button>
                                    </div>
                                </div>
                                <p className="pen-setting-hint">
                                    {appT('tools.sliderHint')}</p>
                            </div>
                        )}
                    </div>

                    <StudyEraserTool
                        active={isEraserMode}
                        popupVisible={showEraserPopup}
                        onClick={handleEraserClick}
                        title={appT(isEraserMode ? 'toolbar.eraserOn' : 'toolbar.eraserOff')}
                        size={eraserSize}
                        setSize={setEraserSize}
                        sizeLabel={appT('toolbar.size')}
                    />
                    <StudyTextTool
                        active={isTextMode}
                        popupVisible={showTextPopup}
                        onClick={handleTextClick}
                        title={appT(isTextMode ? 'toolbar.textOn' : 'toolbar.textOff')}
                        fontSize={textFontSize}
                        setFontSize={setTextFontSize}
                        direction={textDirection}
                        setDirection={setTextDirection}
                        color={penColor}
                        setColor={setPenColor}
                        labels={{
                            size: appT('toolbar.size'), direction: appT('toolbar.direction'),
                            horizontal: appT('toolbar.horizontal'),
                            verticalRight: appT('toolbar.verticalRight'), verticalLeft: appT('toolbar.verticalLeft'),
                            color: appT('toolbar.colorLabel'),
                        }}
                        colorInputStyle={{ width: '40px', height: '30px', border: '1px solid #ccc', cursor: 'pointer' }}
                    />

                    {showLayerControls && (
                        <button
                            type="button"
                            className={`layer-toolbar-button ${isLayerPanelOpen ? 'active' : ''}`}
                            onClick={toggleLayerPanel}
                            title={appT('layers.toolbarTitle', { name: activeLayerName })}
                            aria-label={appT('layers.toolbarLabel', { name: activeLayerName })}
                            aria-expanded={isLayerPanelOpen}
                        >
                            <FiLayers size={20} />
                            <span className="layer-count-badge">{layerCount}</span>
                        </button>
                    )}

                    {/* Context-specific buttons */}
                    {onGrade ? (
                        /* Answer panel mode */
                        <>
                            <div className="divider"></div>
                            {setSelectedModel && availableModels && (
                                <select
                                    value={selectedModel}
                                    onChange={(e) => setSelectedModel(e.target.value)}
                                >
                                    <option value="default">{defaultModelName}</option>
                                    {availableModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            )}
                            <button
                                onClick={onGrade}
                                disabled={isGrading}
                                className="btn-submit"
                                title={t('copiStudy.toolbar.grade')}
                                aria-label={t('copiStudy.toolbar.grade')}
                                style={{
                                    cursor: isGrading ? 'wait' : 'pointer',
                                    opacity: isGrading ? 0.6 : 1,
                                    transition: 'all 0.15s',
                                }}
                            >
                                {isGrading ? <FiLoader size={20} className="animate-spin" /> : <FiCheckCircle size={20} />}
                            </button>
                        </>
                    ) : showTeacherGrade ? (
                        <>
                            <div className="divider"></div>
                            <div className="teacher-grade-control" ref={teacherMenuRef}>
                                <button
                                    type="button"
                                    className={`teacher-grade-main teacher-${teacherMode}`}
                                    onClick={startGrading}
                                    disabled={isGrading || !isSplitView}
                                    title={isSplitView
                                        ? t('copiStudy.toolbar.checkWithTeacher', { teacher: selectedTeacher.label })
                                        : t('copiStudy.toolbar.splitRequired')}
                                    aria-label={t('copiStudy.toolbar.checkWithTeacher', { teacher: selectedTeacher.label })}
                                >
                                    {isGrading ? <FiLoader className="animate-spin" /> : selectedTeacher.icon}
                                    <span>{isGrading ? t('copiStudy.toolbar.checking') : selectedTeacher.label}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`teacher-grade-menu-button teacher-${teacherMode}`}
                                    onClick={() => setShowTeacherMenu(previous => !previous)}
                                    disabled={isGrading}
                                    title={t('copiStudy.toolbar.chooseTeacher')}
                                    aria-label={t('copiStudy.toolbar.chooseTeacher')}
                                    aria-expanded={showTeacherMenu}
                                >
                                    <FiChevronDown />
                                </button>
                                {showTeacherMenu && (
                                    <div className="teacher-grade-menu" role="menu">
                                        {allTeacherOptions.map(option => {
                                            const isEnabled = enabledTeacherModes.includes(option.mode);
                                            return (
                                            <button
                                                key={option.mode}
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={teacherMode === option.mode}
                                                aria-disabled={!isEnabled}
                                                disabled={!isEnabled}
                                                className={`${teacherMode === option.mode ? 'selected' : ''} ${!isEnabled ? 'locked' : ''}`}
                                                onClick={() => {
                                                    if (!isEnabled) return;
                                                    setTeacherMode(option.mode);
                                                    setShowTeacherMenu(false);
                                                }}
                                            >
                                                <span className={`teacher-option-icon teacher-${option.mode}`}>{option.icon}</span>
                                                <span className="teacher-option-copy">
                                                    <strong>{option.label}</strong>
                                                    <small>{option.description}</small>
                                                </span>
                                                {teacherMode === option.mode
                                                    ? <span className="teacher-option-check">✓</span>
                                                    : !isEnabled && <span className="teacher-option-lock"><FiLock /></span>}
                                            </button>
                                        )})}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : null}
                </>
            </div>
        </div>
    );
};
