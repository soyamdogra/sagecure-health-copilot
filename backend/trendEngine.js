/**
 * SageCure Longitudinal Health Trend & Outlier Analysis Engine
 * Calculates multi-quarter biomarker trajectories, delta percentage changes,
 * and AI-driven clinical progress insights.
 */

/**
 * Compute longitudinal trend for a patient across their historical reports
 * @param {Array} reports - Array of report objects (ordered from newest to oldest)
 * @returns {Object} Trend analysis summary with time-series series and narrative insights
 */
function analyzeLongitudinalTrends(reports = []) {
  if (!Array.isArray(reports) || reports.length === 0) {
    return {
      hasTrends: false,
      message: 'No historical reports found to compute longitudinal trends.'
    };
  }

  // Ensure chronological order (oldest to newest for plotting)
  const chronologicalReports = [...reports].reverse();

  // Extract common biomarkers across history
  // Focus on major high-impact chronic disease indicators:
  // HbA1c, Fasting Blood Glucose, LDL Cholesterol, Hemoglobin, Platelets, eGFR
  const targetBiomarkers = [
    { key: 'hba1c', name: 'HbA1c', unit: '%', optimalRange: '< 5.7', targetMax: 7.0, isLowerBetter: true },
    { key: 'glucose', name: 'Fasting Blood Glucose', unit: 'mg/dL', optimalRange: '70 - 99', targetMax: 100, isLowerBetter: true },
    { key: 'ldl', name: 'LDL Cholesterol', unit: 'mg/dL', optimalRange: '< 100', targetMax: 100, isLowerBetter: true },
    { key: 'triglycerides', name: 'Triglycerides', unit: 'mg/dL', optimalRange: '< 150', targetMax: 150, isLowerBetter: true },
    { key: 'hemoglobin', name: 'Hemoglobin', unit: 'g/dL', optimalRange: '13.0 - 17.5', targetMin: 13.0, isLowerBetter: false },
    { key: 'platelets', name: 'Platelet Count', unit: '/µL', optimalRange: '150,000 - 450,000', targetMin: 150000, isLowerBetter: false },
    { key: 'egfr', name: 'eGFR Kidney Function', unit: 'mL/min/1.73m²', optimalRange: '> 90', targetMin: 90, isLowerBetter: false }
  ];

  const seriesByMarker = {};
  const clinicalInsights = [];
  const comparisonRows = [];

  targetBiomarkers.forEach(target => {
    const dataPoints = [];

    chronologicalReports.forEach(rep => {
      const bms = rep.fullData?.biomarkers || rep.biomarkers || [];
      const match = bms.find(b => {
        const n = (b.name || '').toLowerCase();
        return n.includes(target.key) || (target.key === 'glucose' && (n.includes('sugar') || n.includes('fbs')));
      });

      if (match && match.value !== undefined) {
        const val = parseFloat(match.value);
        if (!isNaN(val)) {
          dataPoints.push({
            reportId: rep.id,
            date: rep.date,
            value: val,
            unit: match.unit || target.unit,
            status: match.status || 'normal',
            facility: rep.facility || 'Lab'
          });
        }
      }
    });

    if (dataPoints.length >= 2) {
      seriesByMarker[target.name] = {
        meta: target,
        dataPoints: dataPoints
      };

      const baseline = dataPoints[0];
      const previous = dataPoints[dataPoints.length - 2];
      const latest = dataPoints[dataPoints.length - 1];

      // Percentage change from previous quarter: ((latest - prev) / prev) * 100
      const quarterlyPctChange = ((latest.value - previous.value) / previous.value) * 100;
      const baselinePctChange = ((latest.value - baseline.value) / baseline.value) * 100;

      const isPositive = target.isLowerBetter 
        ? quarterlyPctChange < 0 
        : quarterlyPctChange > 0;

      const deltaFormatted = (quarterlyPctChange > 0 ? '+' : '') + quarterlyPctChange.toFixed(1) + '%';
      const baselineDeltaFormatted = (baselinePctChange > 0 ? '+' : '') + baselinePctChange.toFixed(1) + '%';

      comparisonRows.push({
        biomarker: target.name,
        unit: target.unit,
        baselineDate: baseline.date,
        baselineValue: baseline.value,
        previousDate: previous.date,
        previousValue: previous.value,
        currentDate: latest.date,
        currentValue: latest.value,
        quarterlyDelta: deltaFormatted,
        baselineDelta: baselineDeltaFormatted,
        isPositive: isPositive,
        status: latest.status
      });

      // Generate AI clinical narrative
      if (target.key === 'hba1c') {
        if (isPositive) {
          clinicalInsights.push({
            type: 'positive',
            badge: 'Glycemic Control Improvement',
            icon: '🟢',
            text: `Positive trend: Your glycemic control improved by ${Math.abs(quarterlyPctChange).toFixed(1)}% since last quarter (HbA1c declined from ${previous.value}% to ${latest.value}%). Overall improvement from baseline is ${Math.abs(baselinePctChange).toFixed(1)}%.`
          });
        } else {
          clinicalInsights.push({
            type: 'warning',
            badge: 'Glycemic Fluctuation Alert',
            icon: '⚠️',
            text: `Glycemic control shifted upward by ${quarterlyPctChange.toFixed(1)}% (HbA1c increased from ${previous.value}% to ${latest.value}%). Regimen optimization recommended.`
          });
        }
      } else if (target.key === 'ldl') {
        if (isPositive && latest.value > target.targetMax) {
          clinicalInsights.push({
            type: 'caution',
            badge: 'Outlier Watch - Lipid Panel',
            icon: '📉',
            text: `Positive reduction: LDL cholesterol declined by ${Math.abs(quarterlyPctChange).toFixed(1)}% (from ${previous.value} to ${latest.value} mg/dL), but remains an elevated outlier above the 100 mg/dL target. Continued lifestyle & statin protocol advised.`
          });
        }
      } else if (target.key === 'hemoglobin') {
        if (isPositive) {
          clinicalInsights.push({
            type: 'positive',
            badge: 'Hematology Recovery',
            icon: '🩸',
            text: `Positive hematologic recovery: Hemoglobin increased by ${Math.abs(quarterlyPctChange).toFixed(1)}% (from ${previous.value} to ${latest.value} g/dL), reflecting positive response to iron supplementation and nutrition.`
          });
        }
      } else if (target.key === 'glucose') {
        if (isPositive) {
          clinicalInsights.push({
            type: 'positive',
            badge: 'Fasting Glucose Reduction',
            icon: '⚡',
            text: `Fasting blood glucose reduced by ${Math.abs(quarterlyPctChange).toFixed(1)}% (from ${previous.value} to ${latest.value} mg/dL).`
          });
        }
      }
    }
  });

  return {
    hasTrends: Object.keys(seriesByMarker).length > 0,
    reportCount: reports.length,
    series: seriesByMarker,
    comparisonTable: comparisonRows,
    clinicalInsights: clinicalInsights
  };
}

module.exports = {
  analyzeLongitudinalTrends
};
