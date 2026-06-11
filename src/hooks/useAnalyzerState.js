import { useState, useMemo, useEffect, useCallback } from 'react';
import { parseCsv } from '../utils/csv';
import { loadSavedState, saveState } from '../utils/storage';

export function useAnalyzerState() {
  const saved = useMemo(() => loadSavedState(), []);
  const [data, setData] = useState(saved?.data ?? null);
  const [selectedAccounts, setSelectedAccounts] = useState(saved?.selectedAccounts ?? []);
  const [monthRange, setMonthRange] = useState(saved?.monthRange ?? 6);
  const [fileName, setFileName] = useState(saved?.fileName ?? null);

  const allAccounts = useMemo(
    () => (data ? [...new Set(data.map((t) => t.Account))] : []),
    [data],
  );
  const availableMonthCount = useMemo(
    () => (data ? new Set(data.map((t) => t['Pay Month'])).size : 3),
    [data],
  );

  useEffect(() => {
    setMonthRange((prev) => Math.min(Math.max(3, prev), Math.max(3, availableMonthCount)));
  }, [availableMonthCount]);

  useEffect(() => {
    if (!data) return;
    saveState({ data, selectedAccounts, monthRange, fileName });
  }, [data, selectedAccounts, monthRange, fileName]);

  const toggleAccount = useCallback((acc) => {
    setSelectedAccounts((prev) =>
      prev.includes(acc) ? prev.filter((a) => a !== acc) : [...prev, acc],
    );
  }, []);

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const parsedData = parseCsv(event.target.result);
      setData(parsedData);
      setSelectedAccounts([...new Set(parsedData.map((t) => t.Account))]);
      setFileName(file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  return {
    data,
    selectedAccounts,
    monthRange,
    setMonthRange,
    fileName,
    allAccounts,
    availableMonthCount,
    toggleAccount,
    handleFileUpload,
  };
}
