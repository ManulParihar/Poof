'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import {
  StackedNormalizedAreaChart,
  LinearXAxis,
  LinearXAxisTickSeries,
  LinearXAxisTickLabel,
  LinearYAxis,
  LinearYAxisTickSeries,
  StackedNormalizedAreaSeries,
  Line,
  Area,
  Gradient,
  GradientStop,
  GridlineSeries,
  Gridline,
  ChartDataTypes,
} from 'reaviz';
import { useWallet } from '../../store/wallet';
import { formatAmount } from '../../lib/currencies';

// --- Poof Themed Types ---
interface ChartDataPoint {
  key: Date;
  data: number | null | undefined;
}

interface ChartSeries {
  key: string;
  data: ChartDataPoint[];
}

interface LegendItem {
  name: string;
  color: string;
}

interface TimePeriodOption {
  value: string;
  label: string;
}

interface ActivityStat {
  id: string;
  title: string;
  count: number;
  countFrom?: number;
  comparisonText: string;
  percentage: number;
  TrendIconSvg: React.FC<{ strokeColor: string }>;
  trendColor: string;
  trendBgColor: string;
}

interface DetailedMetric {
  id: string;
  Icon: React.FC<{ className?: string; fill?: string }>;
  label: string;
  tooltip: string;
  value: string;
  TrendIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }>;
  trendBaseColor: string;
  trendStrokeColor: string;
  delay: number;
  iconFillColor?: string;
}

// --- Poof Themed Icons (Gold + Lavender) ---
const ShieldIcon: React.FC<{ className?: string; fill?: string }> = ({ className, fill = "#E8D5A3" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 2L3 5V10C3 14.4183 6.58172 18 11 18C15.4183 18 19 14.4183 19 10V5L10 2Z" stroke={fill} strokeWidth="1.5" fill="rgba(232,213,163,0.1)"/>
    <path d="M7 10L9 12L13 8" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const NoteIcon: React.FC<{ className?: string; fill?: string }> = ({ className, fill = "#E8D5A3" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M5 3H15C16.1046 3 17 3.89543 17 5V15C17 16.1046 16.1046 17 15 17H5C3.89543 17 3 16.1046 3 15V5C3 3.89543 3.89543 3 5 3Z" stroke={fill} strokeWidth="1.5"/>
    <path d="M6 7H14M6 11H10" stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const FlowIcon: React.FC<{ className?: string; fill?: string }> = ({ className, fill = "#E8D5A3" }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M3 10H17M17 10L13 6M17 10L13 14" stroke={fill} strokeWidth="2" strokeLinecap="round"/>
    <path d="M17 10H3" stroke="#A78BFA" strokeWidth="1.5" strokeDasharray="2 2"/>
  </svg>
);

// Trend icons (reusing from previous Poof theme)
const TrendUp: React.FC<{ strokeColor: string }> = ({ strokeColor }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
    <path d="M5.50134 9.11119L10.0013 4.66675M10.0013 4.66675L14.5013 9.11119M10.0013 4.66675L10.0013 16.3334" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const TrendDown: React.FC<{ strokeColor: string }> = ({ strokeColor }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none">
    <path d="M14.4987 11.8888L9.99866 16.3333M9.99866 16.3333L5.49866 11.8888M9.99866 16.3333V4.66658" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const DetailedTrendUpIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }> = ({ baseColor, strokeColor, className }) => (
  <svg className={className} width="28" height="28" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="14" fill={baseColor} fillOpacity="0.4" />
    <path d="M9.50134 12.6111L14.0013 8.16663M14.0013 8.16663L18.5013 12.6111M14.0013 8.16663L14.0013 19.8333" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const DetailedTrendDownIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }> = ({ baseColor, strokeColor, className }) => (
  <svg className={className} width="28" height="28" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="14" fill={baseColor} fillOpacity="0.4" />
    <path d="M18.4987 15.3889L13.9987 19.8334M13.9987 19.8334L9.49866 15.3889M13.9987 19.8334V8.16671" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

// --- Data ---
const LEGEND_ITEMS: LegendItem[] = [
  { name: 'Deposits', color: '#E8D5A3' },
  { name: 'Sends', color: '#A78BFA' },
  { name: 'Withdraws', color: '#E85A9E' },
];

const CHART_COLOR_SCHEME = ['#E8D5A3', '#A78BFA', '#E85A9E'];

const TIME_PERIOD_OPTIONS: TimePeriodOption[] = [
  { value: 'last-7-days', label: 'Last 7 Days' },
  { value: 'last-30-days', label: 'Last 30 Days' },
];

const now = new Date();
const generateDate = (offsetDays: number): Date => {
  const date = new Date(now);
  date.setDate(now.getDate() - offsetDays);
  return date;
};

// Generate sample data (in real app this would come from wallet tx history)
const getMockChartData = (): ChartSeries[] => [
  {
    key: 'Deposits',
    data: Array.from({ length: 7 }, (_, i) => ({ key: generateDate(6 - i), data: Math.floor(Math.random() * 18) + 8 })),
  },
  {
    key: 'Sends',
    data: Array.from({ length: 7 }, (_, i) => ({ key: generateDate(6 - i), data: Math.floor(Math.random() * 14) + 5 })),
  },
  {
    key: 'Withdraws',
    data: Array.from({ length: 7 }, (_, i) => ({ key: generateDate(6 - i), data: Math.floor(Math.random() * 10) + 2 })),
  },
];

const validateChartData = (data: ChartSeries[]) => {
  return data.map(series => ({
    key: series.key,
    data: series.data.map(item => ({
      key: item.key,
      data: (typeof item.data !== 'number' || isNaN(item.data)) ? 0 : item.data,
    })),
  }));
};

const ACTIVITY_STATS: ActivityStat[] = [
  {
    id: 'transfers',
    title: 'Private Transfers',
    count: 47,
    countFrom: 0,
    comparisonText: 'Compared to 39 last period',
    percentage: 18,
    TrendIconSvg: TrendUp,
    trendColor: 'text-[#E8D5A3]',
    trendBgColor: 'bg-[#E8D5A3]/20',
  },
  {
    id: 'notes',
    title: 'Notes Created',
    count: 128,
    countFrom: 0,
    comparisonText: 'Compared to 114 last period',
    percentage: 9,
    TrendIconSvg: TrendUp,
    trendColor: 'text-[#A78BFA]',
    trendBgColor: 'bg-[#A78BFA]/20',
  },
];

const DETAILED_METRICS: DetailedMetric[] = [
  {
    id: 'avgsize',
    Icon: ShieldIcon,
    label: 'Avg Private Transfer',
    tooltip: 'Average value moved privately',
    value: '142 XLM',
    TrendIcon: DetailedTrendUpIcon,
    trendBaseColor: '#E8D5A3',
    trendStrokeColor: '#D4B36E',
    delay: 0,
    iconFillColor: '#E8D5A3',
  },
  {
    id: 'interval',
    Icon: NoteIcon,
    label: 'Mean Time Between Actions',
    tooltip: 'Average time between your private moves',
    value: '2.4 days',
    TrendIcon: DetailedTrendDownIcon,
    trendBaseColor: '#A78BFA',
    trendStrokeColor: '#7B6BFF',
    delay: 0.05,
    iconFillColor: '#A78BFA',
  },
  {
    id: 'mix',
    Icon: FlowIcon,
    label: 'Privacy Mix Rate',
    tooltip: 'How well your value is mixed',
    value: '94%',
    TrendIcon: DetailedTrendUpIcon,
    trendBaseColor: '#E8D5A3',
    trendStrokeColor: '#D4B36E',
    delay: 0.1,
    iconFillColor: '#E8D5A3',
  },
];

const AdvancedPoofActivityReport: React.FC = () => {
  const [selectedTimePeriod, setSelectedTimePeriod] = useState<string>(TIME_PERIOD_OPTIONS[0].value);
  const wallet = useWallet();

  // In a real enhancement, filter wallet.txs and notes by selectedTimePeriod
  const chartData = useMemo(() => validateChartData(getMockChartData()), []);

  // Simple derived stats from real wallet (for authenticity)
  const realNoteCount = wallet.notes.filter(n => !n.spent && !n.invalidReason).length;
  const realTxCount = wallet.txs.length;

  return (
      <div className="flex flex-col justify-between pt-4 pb-4 bg-poof-card rounded-3xl shadow-glow border border-poof-border w-full overflow-hidden">
        {/* Header - Poof Style */}
        <div className="flex justify-between items-center p-7 pt-6 pb-6">
          <div>
            <h3 className="text-2xl font-semibold text-poof-text">Private Activity Report</h3>
            <p className="text-poof-muted text-xs mt-0.5">Your shielded value flows — no one else sees the details.</p>
          </div>
          <select
            value={selectedTimePeriod}
            onChange={(e) => setSelectedTimePeriod(e.target.value)}
            className="bg-poof-surface text-poof-text border border-poof-border p-2 pt-1.5 pb-1.5 rounded-xl text-sm focus:outline-none focus:border-poof-gold"
            aria-label="Select time period"
          >
            {TIME_PERIOD_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Legend - Gold/Lavender */}
        <div className="flex gap-6 w-full pl-7 pr-7 mb-2">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.name} className="flex gap-2 items-center">
              <div className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: item.color }} />
              <span className="text-poof-muted text-xs">{item.name}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="reaviz-chart-container h-[260px] px-4">
          <StackedNormalizedAreaChart
            height={260}
            id="poof-stacked-activity"
            data={chartData}
            xAxis={
              <LinearXAxis
                type="time"
                tickSeries={
                  <LinearXAxisTickSeries
                    label={
                      <LinearXAxisTickLabel
                        format={v => new Date(v).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        fill="#8B7FA3"
                      />
                    }
                  />
                }
              />
            }
            yAxis={<LinearYAxis type="value" />}
            series={
              <StackedNormalizedAreaSeries line={<Line strokeWidth={1.5} />} />
            }
            gridlines={<GridlineSeries line={<Gridline strokeColor="#3F385250" />} />}
          />
        </div>

        {/* Summary Stats - Poof Gold/Lavender */}
        <div className="flex flex-col sm:flex-row w-full pl-7 pr-7 justify-between pb-1 pt-6 gap-4">
          {ACTIVITY_STATS.map((stat, index) => (
            <div key={stat.id} className="flex flex-col gap-1.5 w-full sm:w-1/2">
              <span className="text-base text-poof-text">{stat.title}</span>
              <div className="flex items-center gap-2">
                <CountUp
                  className="font-mono text-3xl font-semibold text-poof-text tabular-nums"
                  start={stat.countFrom || 0}
                  end={index === 0 ? realTxCount || stat.count : realNoteCount || stat.count}
                  duration={2.2}
                />
                <div className={`flex items-center gap-1 ${stat.trendBgColor} p-1 pl-2 pr-2 rounded-full text-xs ${stat.trendColor}`}>
                  <stat.TrendIconSvg strokeColor={stat.trendColor.includes('E8D5A3') ? '#E8D5A3' : '#A78BFA'} />
                  {stat.percentage}%
                </div>
              </div>
              <span className="text-poof-muted text-xs">{stat.comparisonText}</span>
            </div>
          ))}
        </div>

        {/* Detailed Metrics - Animated + Poof Colors */}
        <div className="flex flex-col pl-7 pr-7 font-mono divide-y divide-poof-border mt-4 text-sm">
          {DETAILED_METRICS.map((metric) => (
            <motion.div
              key={metric.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: metric.delay }}
              className="flex w-full py-3.5 items-center gap-3"
            >
              <div className="flex flex-row gap-2 items-center w-1/2 text-poof-muted">
                <metric.Icon fill={metric.iconFillColor} className="h-4 w-4" />
                <span className="truncate" title={metric.tooltip}>{metric.label}</span>
              </div>
              <div className="flex gap-2 w-1/2 justify-end items-center">
                <span className="font-semibold text-poof-text tabular-nums">{metric.value}</span>
                <metric.TrendIcon baseColor={metric.trendBaseColor} strokeColor={metric.trendStrokeColor} className="h-5 w-5" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
  );
};

export default AdvancedPoofActivityReport;