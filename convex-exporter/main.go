package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	"io"
	"io/ioutil"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	convexBackendURL = getEnv("CONVEX_BACKEND_URL", "http://backend:3210")
	convexAdminKeyPath = getEnv("CONVEX_ADMIN_KEY_PATH", "/data/admin_key.txt")
	scrapeInterval = getEnvAsInt("SCRAPE_INTERVAL", 30)

	// Prometheus metrics
	functionExecutionTime = prometheus.NewSummaryVec(
		prometheus.SummaryOpts{
			Name: "convex_function_execution_seconds",
			Help: "Convex function execution time in seconds",
		},
		[]string{"type", "identifier"},
	)

	functionCount = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "convex_function_count",
			Help: "Convex function call count",
		},
		[]string{"type", "identifier"},
	)

	dbReadBytes = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "convex_database_read_bytes",
			Help: "Convex database read bytes",
		},
		[]string{"function"},
	)

	dbWriteBytes = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "convex_database_write_bytes",
			Help: "Convex database write bytes",
		},
		[]string{"function"},
	)

	errorCount = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "convex_errors_total",
			Help: "Convex function error count",
		},
		[]string{"type", "identifier"},
	)

	queryCacheHits = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "convex_query_cache_hits",
			Help: "Convex query cache hits",
		},
	)

	queryCacheMisses = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "convex_query_cache_misses",
			Help: "Convex query cache misses",
		},
	)
)

type ConvexLogEntry struct {
	ExecutionTime   float64 `json:"executionTime"`
	UDFType        string  `json:"udfType"`
	Identifier      string  `json:"identifier"`
	Error           string  `json:"error,omitempty"`
	CachedResult    bool    `json:"cachedResult,omitempty"`
	UsageStats      *UsageStats `json:"usageStats,omitempty"`
}

type UsageStats struct {
	DatabaseReadBytes  float64 `json:"databaseReadBytes"`
	DatabaseWriteBytes float64 `json:"databaseWriteBytes"`
}

func init() {
	prometheus.MustRegister(functionExecutionTime)
	prometheus.MustRegister(functionCount)
	prometheus.MustRegister(dbReadBytes)
	prometheus.MustRegister(dbWriteBytes)
	prometheus.MustRegister(errorCount)
	prometheus.MustRegister(queryCacheHits)
	prometheus.MustRegister(queryCacheMisses)
}

func main() {
	log.Println("Starting Convex Metrics Exporter...")

	// Start metrics endpoint
	http.Handle("/metrics", promhttp.Handler())
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Start scraping goroutine
	go scrapeConvexLogs()

	log.Printf("Server listening on :9101")
	log.Fatal(http.ListenAndServe(":9101", nil))
}

func scrapeConvexLogs() {
	for {
		log.Println("Scraping Convex logs...")
		if err := fetchAndProcessLogs(); err != nil {
			log.Printf("Error scraping logs: %v", err)
		}
		time.Sleep(time.Duration(scrapeInterval) * time.Second)
	}
}

func fetchAndProcessLogs() error {
	// Read admin key
	adminKey, err := ioutil.ReadFile(convexAdminKeyPath)
	if err != nil {
		return fmt.Errorf("failed to read admin key: %w", err)
	}

	// Fetch logs from Convex
	url := fmt.Sprintf("%s/api/stream_function_logs", convexBackendURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Convex "+string(adminKey))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch logs: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := ioutil.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status code: %d, body: %s", resp.StatusCode, body)
	}

	// Process logs
	decoder := json.NewDecoder(resp.Body)
	for {
		var logEntry ConvexLogEntry
		if err := decoder.Decode(&logEntry); err == io.EOF {
			break
		} else if err != nil {
			log.Printf("Error decoding log entry: %v", err)
			continue
		}

		processLogEntry(&logEntry)
	}

	return nil
}

func processLogEntry(log *ConvexLogEntry) {
	// Record execution time
	functionExecutionTime.WithLabelValues(log.UDFType, log.Identifier).Observe(log.ExecutionTime)

	// Record function count
	functionCount.WithLabelValues(log.UDFType, log.Identifier).Inc()

	// Record errors
	if log.Error != "" {
		errorCount.WithLabelValues(log.UDFType, log.Identifier).Inc()
	}

	// Record database stats
	if log.UsageStats != nil {
		dbReadBytes.WithLabelValues(log.Identifier).Add(log.UsageStats.DatabaseReadBytes)
		dbWriteBytes.WithLabelValues(log.Identifier).Add(log.UsageStats.DatabaseWriteBytes)
	}

	// Record query cache stats
	if log.UDFType == "Query" {
		if log.CachedResult {
			queryCacheHits.Inc()
		} else {
			queryCacheMisses.Inc()
		}
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func getEnvAsInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	var intValue int
	_, err := fmt.Sscanf(value, "%d", &intValue)
	if err != nil {
		return defaultValue
	}
	return intValue
}
