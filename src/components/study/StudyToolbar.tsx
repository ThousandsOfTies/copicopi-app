import React, { useEffect, useRef, useState } from 'react';
import { ICON_SVG } from '../../constants/icons';
import { FiChevronDown, FiHeart, FiHome, FiRotateCcw, FiTrash2, FiCheckCircle, FiLoader, FiType, FiEdit2, FiDroplet, FiSliders, FiTarget } from 'react-icons/fi';
import { BiBrush, BiEraser, BiHighlight, BiPalette, BiPencil, BiSolidCircle } from 'react-icons/bi';
import { MdBalance } from 'react-icons/md';

export type TextDirection = 'horizontal' | 'vertical-rl' | 'vertical-lr';
export type BrushType = 'solid' | 'watercolor';
export type StrokeStyle = 'pencil' | 'marker' | 'brush';
export type TeacherMode = 'kind' | 'balanced' | 'strict';

export interface BreadcrumbItem {
    label: string;
    onClick: () => void;
    isCurrent?: boolean;
}

interface StudyToolbarProps {
    onBack?: () => void;
    breadcrumbs?: BreadcrumbItem[];
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

    // Actions
    onUndo: () => void;
    onClear: () => void;
    onClearAll: () => void;

    // Answer panel actions (shown when on answer panel)
    onGrade?: () => void;
    canUndoAnswer?: boolean;
    onUndoAnswer?: () => void;
    onClearAnswer?: () => void;
    selectedModel?: string;
    setSelectedModel?: (model: string) => void;
    availableModels?: Array<{ id: string; name: string; description?: string }>;
    defaultModelName?: string;
}

export const StudyToolbar: React.FC<StudyToolbarProps> = ({
    onBack,
    breadcrumbs,
    isSplitView,
    toggleSplitView,
    activeTab,
    toggleActiveTab,
    isGrading,
    startGrading,
    showTeacherGrade,
    teacherMode,
    setTeacherMode,
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
    onUndo,
    onClear,
    onClearAll,
    onGrade,
    canUndoAnswer,
    onUndoAnswer,
    onClearAnswer,
    selectedModel,
    setSelectedModel,
    availableModels,
    defaultModelName,
}) => {
    // Popups visibility state
    const [showTextPopup, setShowTextPopup] = useState(false);
    const [showPenPopup, setShowPenPopup] = useState(false);
    const [showEraserPopup, setShowEraserPopup] = useState(false);
    const [showTeacherMenu, setShowTeacherMenu] = useState(false);
    const teacherMenuRef = useRef<HTMLDivElement>(null);
    const colorPresets = [
        '#000000', '#4b5563', '#9ca3af', '#ffffff', '#7f1d1d', '#dc2626', '#fb7185', '#fda4af',
        '#7c2d12', '#ea580c', '#fb923c', '#fed7aa', '#854d0e', '#eab308', '#fde047', '#fef3c7',
        '#14532d', '#16a34a', '#4ade80', '#bbf7d0', '#064e3b', '#14b8a6', '#5eead4', '#ccfbf1',
        '#1e3a8a', '#2563eb', '#60a5fa', '#bfdbfe', '#4c1d95', '#7c3aed', '#a78bfa', '#ddd6fe',
        '#831843', '#db2777', '#f472b6', '#fbcfe8', '#713f12', '#a16207', '#d6a75d', '#f5e6c8'
    ];

    const teacherOptions: Array<{ mode: TeacherMode; label: string; description: string; icon: React.ReactNode }> = [
        { mode: 'kind', label: 'KIND', description: 'Good points first', icon: <FiHeart /> },
        { mode: 'balanced', label: 'BALANCED', description: 'Clear and practical', icon: <MdBalance /> },
        { mode: 'strict', label: 'STRICT', description: 'Detailed and precise', icon: <FiTarget /> },
    ];
    const selectedTeacher = teacherOptions.find(option => option.mode === teacherMode) || teacherOptions[0];

    useEffect(() => {
        if (!showTeacherMenu) return;
        const closeMenu = (event: MouseEvent) => {
            if (!teacherMenuRef.current?.contains(event.target as Node)) setShowTeacherMenu(false);
        };
        document.addEventListener('mousedown', closeMenu);
        return () => document.removeEventListener('mousedown', closeMenu);
    }, [showTeacherMenu]);

    // Wrappers to toggle popups and modes
    const handleTextClick = () => {
        if (isTextMode) {
            setShowTextPopup(!showTextPopup);
        } else {
            toggleTextMode();
            setShowTextPopup(false);
            setShowPenPopup(false);
            setShowEraserPopup(false);
        }
    };

    const handlePenClick = () => {
        if (isDrawingMode) {
            setShowPenPopup(!showPenPopup);
        } else {
            toggleDrawingMode();
            setShowPenPopup(false);
            setShowEraserPopup(false);
            setShowTextPopup(false);
        }
    };

    const handleEraserClick = () => {
        if (isEraserMode) {
            setShowEraserPopup(!showEraserPopup);
        } else {
            toggleEraserMode();
            setShowEraserPopup(false);
            setShowPenPopup(false);
            setShowTextPopup(false);
        }
    };

    return (
        <div className="toolbar">
            {/* 戻るボタン */}
            {onBack && (
                <>
                    <button onClick={onBack} title="ホームに戻る" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <FiHome size={20} />
                    </button>

                    {/* パンくず (ホームの横へ移動) */}
                    {breadcrumbs && breadcrumbs.length > 0 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '2px',
                            flexWrap: 'nowrap', overflowX: 'auto', minWidth: 0,
                            scrollbarWidth: 'none', msOverflowStyle: 'none',
                            marginLeft: '8px'
                        }}>
                            {breadcrumbs.map((crumb, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <span style={{ color: '#bbb', fontSize: '13px', flexShrink: 0 }}>›</span>}
                                    <span
                                        onClick={crumb.isCurrent ? undefined : crumb.onClick}
                                        style={{
                                            fontSize: '13px',
                                            color: crumb.isCurrent ? '#333' : '#2c7be5',
                                            fontWeight: crumb.isCurrent ? 600 : 400,
                                            cursor: crumb.isCurrent ? 'default' : 'pointer',
                                            padding: '3px 6px',
                                            borderRadius: '10px',
                                            whiteSpace: 'nowrap',
                                            flexShrink: 0,
                                        }}
                                    >
                                        {crumb.label}
                                    </span>
                                </React.Fragment>
                            ))}
                        </div>
                    )}




                </>
            )}



            {/* 右寄せコンテナ */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>

                <>
                    <div className="divider"></div>

                    {/* 描画ツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handlePenClick}
                            className={isDrawingMode ? 'active' : ''}
                            title={isDrawingMode ? 'ペンモード ON（クリックで設定）' : 'ペンモード OFF'}
                        >
                            <FiEdit2 size={20} color={isDrawingMode ? penColor : 'currentColor'} />
                        </button>

                        {/* ペン設定ポップアップ */}
                        {isDrawingMode && showPenPopup && (
                            <div className="tool-popup pen-settings-popup">
                                <div className="popup-row">
                                    <label className="popup-icon-label" title="色" aria-label="色"><BiPalette size={21} /></label>
                                    <input
                                        type="color"
                                        aria-label="色を選択"
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
                                            aria-label={`${color} を選択`}
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
                                    <label className="popup-icon-label" title="質感" aria-label="質感"><FiDroplet size={19} /></label>
                                    <div className="pen-option-group">
                                        <button type="button" aria-label="くっきり" title="くっきり（不透明）" className={brushType === 'solid' ? 'active' : ''} onClick={() => setBrushType('solid')}><BiSolidCircle size={20} /></button>
                                        <button type="button" aria-label="水彩" title="水彩（半透明）" className={brushType === 'watercolor' ? 'active' : ''} onClick={() => setBrushType('watercolor')}><FiDroplet size={19} /></button>
                                    </div>
                                </div>
                                <div className="popup-row">
                                    <label className="popup-icon-label" title="描き味" aria-label="描き味"><BiBrush size={21} /></label>
                                    <div className="pen-option-group">
                                        <button type="button" aria-label="えんぴつ" title="えんぴつ" className={strokeStyle === 'pencil' ? 'active' : ''} onClick={() => setStrokeStyle('pencil')}><BiPencil size={20} /></button>
                                        <button type="button" aria-label="マーカー" title="マーカー" className={strokeStyle === 'marker' ? 'active' : ''} onClick={() => setStrokeStyle('marker')}><BiHighlight size={20} /></button>
                                        <button type="button" aria-label="筆" title="筆（速度で太さが変化）" className={strokeStyle === 'brush' ? 'active' : ''} onClick={() => setStrokeStyle('brush')}><BiBrush size={20} /></button>
                                    </div>
                                </div>
                                <div className="popup-row">
                                    <label className="popup-icon-label" title="太さ" aria-label="太さ"><FiSliders size={19} /></label>
                                    <input
                                        type="range"
                                        min="1"
                                        max="100"
                                        value={penSize}
                                        onChange={(e) => setPenSize(Number(e.target.value))}
                                        style={{ width: '100px' }}
                                    />
                                    <span>{penSize}px</span>
                                </div>
                                {brushType === 'watercolor' && (
                                    <div className="popup-row">
                                        <label className="popup-icon-label" title="濃さ" aria-label="濃さ"><FiDroplet size={18} /></label>
                                        <input
                                            type="range"
                                            min="10"
                                            max="70"
                                            value={Math.round(watercolorOpacity * 100)}
                                            onChange={(e) => setWatercolorOpacity(Number(e.target.value) / 100)}
                                            style={{ width: '100px' }}
                                        />
                                        <span>{Math.round(watercolorOpacity * 100)}%</span>
                                    </div>
                                )}
                                <p className="pen-setting-hint">
                                    {brushType === 'solid' ? '不透明' : '半透明（すべての描き味に適用）'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 消しゴムツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handleEraserClick}
                            className={isEraserMode ? 'active' : ''}
                            title={isEraserMode ? '消しゴムモード ON（クリックで設定）' : '消しゴムモード OFF'}
                        >
                            <BiEraser size={20} className="icon-scale-13" />
                        </button>

                        {/* 消しゴム設定ポップアップ */}
                        {isEraserMode && showEraserPopup && (
                            <div className="tool-popup">
                                <div className="popup-row">
                                    <label>サイズ:</label>
                                    <input
                                        type="range"
                                        min="10"
                                        max="100"
                                        value={eraserSize}
                                        onChange={(e) => setEraserSize(Number(e.target.value))}
                                        style={{ width: '100px' }}
                                    />
                                    <span>{eraserSize}px</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* テキスト入力ツール */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={handleTextClick}
                            className={isTextMode ? 'active' : ''}
                            title={isTextMode ? 'テキストモード ON（クリックで設定）' : 'テキストモード OFF'}
                        >
                            <FiType size={20} />
                        </button>

                        {/* テキスト設定ポップアップ */}
                        {isTextMode && showTextPopup && (
                            <div className="tool-popup" style={{ minWidth: '180px' }}>
                                <div className="popup-row">
                                    <label>サイズ:</label>
                                    <input
                                        type="range"
                                        min="10"
                                        max="32"
                                        value={textFontSize}
                                        onChange={(e) => setTextFontSize(Number(e.target.value))}
                                        style={{ width: '80px' }}
                                    />
                                    <span>{textFontSize}px</span>
                                </div>
                                <div className="popup-row">
                                    <label>方向:</label>
                                    <select
                                        value={textDirection}
                                        onChange={(e) => setTextDirection(e.target.value as TextDirection)}
                                        style={{ padding: '4px', borderRadius: '4px' }}
                                    >
                                        <option value="horizontal">横書き (Z型)</option>
                                        <option value="vertical-rl">縦書き右始 (N型)</option>
                                        <option value="vertical-lr">縦書き左始</option>
                                    </select>
                                </div>
                                <div className="popup-row">
                                    <label>色:</label>
                                    <input
                                        type="color"
                                        value={penColor}
                                        onChange={(e) => setPenColor(e.target.value)}
                                        style={{ width: '40px', height: '30px', border: '1px solid #ccc', cursor: 'pointer' }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {!onGrade && (
                        <>
                            <div className="divider" style={{ margin: '0 4px' }}></div>

                            {/* Split View Toggle (Moved to Tool Group) */}
                            <button
                                onClick={toggleSplitView}
                                title={isSplitView ? 'A/Bの位置を入れ替え' : '2画面表示 (Split View)'}
                                className={isSplitView ? 'active' : ''}
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="2" y="4" width="9" height="16" rx="1" stroke="currentColor" strokeWidth="1" fill={isSplitView ? "white" : "none"} />
                                    <rect x="13" y="4" width="9" height="16" rx="1" stroke="currentColor" strokeWidth="1" fill={isSplitView ? "white" : "none"} />
                                </svg>
                            </button>

                            {/* Tab Switcher Button (Widened) */}
                            <button
                                className={`tab-switcher-btn ${!isSplitView ? 'active' : ''}`}
                                onClick={toggleActiveTab}
                                title={isSplitView ? "シングルビューへ切替" : "A/B 切替"}
                                style={{
                                    minWidth: '45px',
                                }}
                            >
                                {/* A Indicator */}
                                <span
                                    style={{
                                        fontWeight: activeTab === 'A' ? 'bold' : 'normal',
                                        textDecoration: activeTab === 'A' ? 'underline' : 'none',
                                        color: activeTab === 'A' ? '#4CAF50' : 'inherit',
                                        fontSize: '0.85rem'
                                    }}
                                >
                                    A
                                </span>

                                <span style={{ margin: '0 4px', color: '#ccc', fontSize: '0.85rem' }}>/</span>


                                {/* B Indicator */}
                                <span
                                    style={{
                                        fontWeight: activeTab === 'B' ? 'bold' : 'normal',
                                        textDecoration: activeTab === 'B' ? 'underline' : 'none',
                                        color: activeTab === 'B' ? '#4CAF50' : 'inherit',
                                        fontSize: '0.85rem'
                                    }}
                                >
                                    B
                                </span>
                            </button>
                        </>
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
                                title="採点する"
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
                                    title={isSplitView ? `${selectedTeacher.label} teacher checks the current A/B view` : 'A/B表示で採点できます'}
                                    aria-label={`${selectedTeacher.label}先生で採点`}
                                >
                                    {isGrading ? <FiLoader className="animate-spin" /> : selectedTeacher.icon}
                                    <span>{isGrading ? 'CHECKING' : selectedTeacher.label}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`teacher-grade-menu-button teacher-${teacherMode}`}
                                    onClick={() => setShowTeacherMenu(previous => !previous)}
                                    disabled={isGrading}
                                    title="先生を選ぶ"
                                    aria-label="先生を選ぶ"
                                    aria-expanded={showTeacherMenu}
                                >
                                    <FiChevronDown />
                                </button>
                                {showTeacherMenu && (
                                    <div className="teacher-grade-menu" role="menu">
                                        {teacherOptions.map(option => (
                                            <button
                                                key={option.mode}
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={teacherMode === option.mode}
                                                className={teacherMode === option.mode ? 'selected' : ''}
                                                onClick={() => {
                                                    setTeacherMode(option.mode);
                                                    setShowTeacherMenu(false);
                                                }}
                                            >
                                                <span className={`teacher-option-icon teacher-${option.mode}`}>{option.icon}</span>
                                                <span className="teacher-option-copy">
                                                    <strong>{option.label}</strong>
                                                    <small>{option.description}</small>
                                                </span>
                                                {teacherMode === option.mode && <span className="teacher-option-check">✓</span>}
                                            </button>
                                        ))}
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
