# SchuimSurfer 🌊

**An Educational Social Media Network Analysis & Coordinated Inauthentic Behavior (CIB) Detection Tool**

SchuimSurfer is a browser-based visualization and analysis tool for social media data, designed to help researchers, journalists, and educators understand network structures, detect coordinated behavior patterns, and learn about computational social science methods.

---

## 📋 Table of Contents

- [What is SchuimSurfer?](#what-is-schuimsurfer)
- [Key Features](#key-features)
- [Getting Started](#getting-started)
- [Understanding the Interface](#understanding-the-interface)
- [Network Visualization](#network-visualization)
- [CIB Detection](#cib-detection)
- [Advanced CIB Settings](#advanced-cib-settings)
- [Data Format](#data-format)
- [Educational Context](#educational-context)
- [Tips & Best Practices](#tips--best-practices)
- [Technical Details](#technical-details)

---

## What is SchuimSurfer?

SchuimSurfer (Dutch for "foam surfer") is a client-side web application that analyzes social media networks and detects coordinated inauthentic behavior (CIB). It processes data from platforms like TikTok and Instagram to:

1. **Visualize network structures** (mention networks, hashtag networks, engagement patterns)
2. **Detect coordinated behavior** using multiple academic methods
3. **Identify communities** within social networks
4. **Calculate network metrics** (centrality, clustering, density)

**Privacy-First:** All processing happens in your browser. No data is sent to servers.

---

## Key Features

### 🎨 **Interactive Network Visualization**
- **GPU-accelerated rendering** for smooth performance with large networks
- **Force-directed layout** that reveals network structure
- **Multiple network types:**
  - Mention networks (who mentions whom)
  - Hashtag networks (shared hashtag usage)
  - Engagement networks (likes/comments patterns)
- **Color-coded nodes** by community detection
- **Visual indicators** for suspicious accounts (red borders)

### 🔍 **Advanced CIB Detection**
Uses **10 research-backed methods** to identify coordinated behavior:

1. **Semantic Similarity** (AI-powered, 🤖) - Detects paraphrased coordination
2. **Synchronized Posting** - Identifies coordinated timing
3. **TF-IDF Hashtag Analysis** - Finds rare coordinated hashtags
4. **Username Pattern Matching** - Detects similar account names
5. **Z-Score Volume Analysis** - Statistical outlier detection
6. **Temporal Burst Detection** - Identifies posting campaigns
7. **Posting Rhythm Analysis** - Detects bot-like regularity
8. **24/7 Activity Detection** - Finds accounts with no sleep gaps
9. **N-gram Template Matching** - Detects caption templates
10. **Account Creation Clustering** - Identifies bot farm patterns

### 📊 **Network Analytics**
- **Community Detection** (Louvain algorithm)
- **Centrality Metrics** (degree, betweenness, closeness, eigenvector)
- **Network Statistics** (density, clustering coefficient, modularity)
- **Interactive Node Inspection** - Click nodes to see detailed profiles

### ⚙️ **Customizable Parameters**
- Adjustable detection sensitivity
- Time windows for synchronization
- Advanced threshold tuning for power users
- Engagement filters and date ranges

---

## Getting Started

### Step 1: Obtain Social Media Data

SchuimSurfer works with JSON data exported from social media platforms. You'll need data containing:
- Post metadata (timestamps, captions, hashtags)
- Author information (usernames, IDs)
- Engagement metrics (likes, comments, shares)

**Supported formats:**
- TikTok export data
- Instagram export data
- Custom JSON (see [Data Format](#data-format))

### Step 2: Load Your Data

1. Open `schuimsurfer.html` in a modern web browser (Chrome, Firefox, or Edge recommended)
2. Click the **"📁 Upload Data"** button
3. Select your JSON file
4. Wait for processing (you'll see statistics appear)

### Step 3: Choose Network Type

Select from the dropdown menu:
- **Mention Network** - Shows @mention connections
- **Hashtag Network** - Shows accounts using similar hashtags
- **Engagement Network** - Shows interaction patterns

### Step 4: Analyze

- Use filters to focus on specific date ranges or engagement levels
- Click **"🔍 Detect Communities"** to identify network clusters
- Click **"🛡️ Detect Coordinated Behavior"** to run CIB analysis
- Interact with the visualization to explore individual nodes

---

## Understanding the Interface

### Header Section

**Statistics Bar:**
- 📊 **Total Posts** - Number of posts in dataset
- 👥 **Unique Users** - Distinct accounts
- 🏷️ **Hashtags** - Unique hashtags used
- ❤️ **Total Engagement** - Sum of likes + comments
- 💬 **Avg Engagement** - Mean engagement per post
- ⏰ **Timespan** - Date range of data
- 🔴 **Suspicious Accounts** - CIB detection count

### Sidebar Controls

**Network Settings:**
- **Network Type** - Choose visualization mode
- **Node Size** - Size nodes by followers, engagement, or posts
- **CIB Sensitivity** - Adjust detection strictness (1=lenient, 10=strict)
- **Time Window** - Synchronization window in seconds

**Filters:**
- **Min Engagement** - Filter low-engagement posts
- **Date Range** - Focus on specific time periods
- **Search** - Find specific users by name

**Actions:**
- 📥 **Export Network** - Download graph as JSON
- 🔍 **Detect Communities** - Run Louvain clustering
- 🛡️ **Detect Coordinated Behavior** - Run CIB analysis
- ⚙️ **Advanced CIB Settings** - Fine-tune detection parameters

### Main Canvas

**Visualization Area:**
- **Pan** - Click and drag background
- **Zoom** - Scroll wheel
- **Select Node** - Click any node to see details
- **Visual Encoding:**
  - Node size = importance (followers/engagement)
  - Node color = community membership
  - Red border = flagged as suspicious
  - Edge thickness = connection strength

### Results Panels

**Network Metrics Panel:**
Shows after clicking "Detect Communities"
- Nodes, edges, density
- Average degree, clustering coefficient
- Communities detected, modularity score

**CIB Detection Panel:**
Shows after clicking "Detect Coordinated Behavior"
- Total suspicious accounts
- Breakdown by indicator type
- Risk scores and reasons

**Node Info Panel:**
Shows when clicking a node
- User profile (username, followers, verified status)
- Activity metrics (posts, engagement rate)
- Network position (centrality scores)
- **CIB Risk Assessment** (if flagged)

---

## Network Visualization

### Network Types Explained

#### 1. **Mention Network**
**What it shows:** Direct @mention connections between users

**How to read it:**
- Arrows point from mentioner → mentioned
- Clusters indicate groups that frequently mention each other
- Central nodes are frequently mentioned (influencers/targets)

**Use cases:**
- Identify influence patterns
- Detect astroturfing campaigns (fake grassroots)
- Map conversation networks

#### 2. **Hashtag Network**
**What it shows:** Users connected by shared hashtag usage

**How to read it:**
- Edges connect users who use the same hashtags
- Dense clusters = coordinated hashtag campaigns
- Isolates = unique hashtag strategies

**Use cases:**
- Find coordinated hashtag manipulation
- Identify organic vs. artificial trends
- Detect spam networks

#### 3. **Engagement Network**
**What it shows:** Users who engage with the same content

**How to read it:**
- Edges indicate shared engagement patterns
- Clusters = coordinated liking/commenting
- Central nodes = content with broad appeal

**Use cases:**
- Detect engagement pods
- Identify artificial amplification
- Find genuine communities

### Visual Elements

**Node Properties:**
- **Size** - Configurable (followers, engagement, or post count)
- **Color** - Community membership (algorithm-assigned)
- **Border** - Red = CIB flagged, Blue = verified user
- **Opacity** - Can indicate various metrics

**Edge Properties:**
- **Thickness** - Connection strength (mention count, shared hashtags)
- **Opacity** - Relative importance
- **Direction** - Arrows show directional relationships

**Layout Algorithm:**
- **Force-Directed** - Nodes repel, edges attract
- **Converges** to reveal natural clusters
- **Interactive** - Can be manually adjusted

---

## CIB Detection

### What is Coordinated Inauthentic Behavior?

**CIB** refers to coordinated efforts by multiple accounts to manipulate social media platforms. This includes:
- **Bot networks** - Automated accounts acting in concert
- **Troll farms** - Organized groups posting divisive content
- **Astroturfing** - Fake grassroots campaigns
- **Engagement pods** - Groups artificially inflating metrics

### Detection Methods

SchuimSurfer uses **multi-indicator analysis** combining:

#### 1. **🤖 Semantic Similarity (AI-Powered)**
**Method:** Sentence embeddings with cosine similarity  
**Detects:** Paraphrased coordination ("Buy now!" vs "Purchase today!")  
**Threshold:** 0.85 similarity (85% semantic match)  
**Why it matters:** Sophisticated actors avoid exact copies

**Academic basis:** Transformer-based NLP (Xenova/all-MiniLM-L6-v2)

#### 2. **⏱️ Synchronized Posting**
**Method:** Temporal correlation analysis  
**Detects:** Posts within narrow time windows  
**Threshold:** Configurable (default: 300 seconds)  
**Why it matters:** Bots often post simultaneously

**Academic basis:** Event correlation in time-series data

#### 3. **🏷️ TF-IDF Hashtag Analysis**
**Method:** Term Frequency-Inverse Document Frequency weighting  
**Detects:** Rare, coordinated hashtag combinations  
**Threshold:** TF-IDF > 0.5 (filters viral hashtags)  
**Why it matters:** Coordination uses niche signals

**Academic basis:** Information retrieval, signal-to-noise separation

#### 4. **👤 Username Pattern Matching**
**Method:** Levenshtein distance (edit distance)  
**Detects:** Similar usernames (user123, user124, user125)  
**Threshold:** 80% similarity  
**Why it matters:** Bot farms use naming patterns

**Academic basis:** String similarity algorithms

#### 5. **📈 Z-Score Volume Analysis**
**Method:** Statistical normalization  
**Detects:** Outlier posting volumes (adapts to dataset)  
**Threshold:** Z-score > 2 (95th percentile)  
**Why it matters:** Fixed thresholds fail across datasets

**Academic basis:** Statistical outlier detection

#### 6. **💥 Temporal Burst Detection**
**Method:** Sliding window analysis  
**Detects:** Sudden activity spikes (5+ posts in time window)  
**Threshold:** Configurable burst size  
**Why it matters:** Campaigns have distinct bursts

**Academic basis:** Event burst detection in streams

#### 7. **🎵 Posting Rhythm Analysis**
**Method:** Coefficient of Variation (CV) of inter-post intervals  
**Detects:** Overly regular posting (bot-like)  
**Threshold:** CV < 0.1 (10% variation)  
**Why it matters:** Humans post irregularly

**Academic basis:** Behavioral biometrics

#### 8. **🌙 24/7 Activity Detection**
**Method:** Daily gap analysis  
**Detects:** No sleep gaps (automated accounts)  
**Threshold:** Max gap < 2 hours  
**Why it matters:** Humans sleep, bots don't

**Academic basis:** Circadian rhythm analysis

#### 9. **📝 N-gram Template Matching**
**Method:** 5-gram Jaccard similarity  
**Detects:** Template-based captions ("Check out [X]!")  
**Threshold:** 30% overlap  
**Why it matters:** Templates indicate coordination

**Academic basis:** Text fingerprinting

#### 10. **🏭 Account Creation Clustering**
**Method:** Temporal clustering  
**Detects:** Accounts created together (bot farms)  
**Threshold:** 5+ accounts within 24 hours  
**Why it matters:** Batch creation indicates automation

**Academic basis:** Temporal pattern mining

### Interpreting Results

**Risk Scores (0-100):**
- **0-30** - Low risk (possibly organic)
- **31-60** - Medium risk (warrants investigation)
- **61-85** - High risk (likely coordinated)
- **86-100** - Critical risk (multiple indicators)

**Score Calculation:**
- Base points per indicator (15-30 points)
- **Multiplicative bonus** for multiple indicators
- **Combination bonuses** for specific patterns:
  - Username similarity + account clustering = +20 (bot farm)
  - Synchronization + rhythm regularity = +15 (automation)

**Important:** These are **indicators, not proof**. Always verify with manual inspection. Legitimate activism can trigger some signals.

---

## Advanced CIB Settings

For power users who want fine-grained control:

### Accessing Advanced Settings
1. Click **"⚙️ Advanced CIB Settings"** button
2. Panel opens with 10 configurable parameters
3. Hover over labels for explanations
4. Adjust values as needed
5. Click **"Reset to Defaults"** to restore original values

### Parameter Reference

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| **Semantic Similarity** | 0.85 | 0-1 | AI caption matching threshold (higher = stricter) |
| **N-gram Overlap** | 0.3 | 0-1 | Template detection threshold (higher = stricter) |
| **Username Similarity** | 0.8 | 0-1 | Levenshtein distance threshold (higher = stricter) |
| **TF-IDF Threshold** | 0.5 | 0-2 | Rare hashtag sensitivity (higher = rarer only) |
| **Z-Score Threshold** | 2 | 1-4 | Volume outlier detection (2 = 95th percentile) |
| **Burst Min Posts** | 5 | 3-10 | Posts needed to trigger burst detection |
| **Rhythm CV Threshold** | 0.1 | 0-0.5 | Regularity detection (lower = more regular needed) |
| **Night Gap (seconds)** | 7200 | 3600-14400 | Max gap for 24/7 detection (7200 = 2 hours) |
| **Cluster Min Size** | 5 | 3-10 | Min accounts in creation cluster |
| **Cross-Indicator Bonus** | 0.3 | 0.1-0.5 | Score multiplier per indicator |

### Tuning Strategies

**Increase precision (fewer false positives):**
- Raise semantic similarity → 0.90+
- Raise z-score threshold → 2.5+
- Raise cluster min size → 7+

**Increase recall (catch more suspects):**
- Lower semantic similarity → 0.75-0.80
- Lower z-score threshold → 1.5
- Lower burst min posts → 3-4

**Dataset-specific tuning:**
- Small datasets: Lower thresholds (more signals needed)
- Large datasets: Higher thresholds (noise filtering)
- Activism-heavy: Raise thresholds (avoid false positives)
- Bot-heavy: Lower thresholds (catch subtle coordination)

---

## Data Format

SchuimSurfer accepts JSON files with the following structure:

### Required Fields

```json
[
  {
    "data": {
      "id": "post_unique_id",
      "createTime": 1234567890,
      "desc": "Post caption text",
      "author": {
        "id": "user_unique_id",
        "uniqueId": "username",
        "nickname": "Display Name",
        "verified": false
      },
      "stats": {
        "diggCount": 100,
        "commentCount": 10,
        "shareCount": 5
      },
      "challenges": [
        { "title": "hashtag1" },
        { "title": "hashtag2" }
      ]
    }
  }
]
```

### Optional Fields

```json
{
  "data": {
    "authorStats": {
      "followerCount": 1000,
      "followingCount": 500,
      "heartCount": 50000,
      "videoCount": 100
    },
    "textExtra": [
      { 
        "userUniqueId": "mentioned_user",
        "userId": "mentioned_user_id"
      }
    ]
  }
}
```

### Platform-Specific Notes

**TikTok Data:**
- Uses `challenges` for hashtags
- `textExtra` contains @mentions
- `diggCount` = likes

**Instagram Data:**
- Hashtags in `desc` or separate field
- Comments contain mentions
- Different engagement field names

**Custom Data:**
- Adapt field names in normalization function
- Ensure timestamps are Unix epoch (seconds)
- Include at minimum: author, timestamp, content

---

## Educational Context

### Learning Objectives

SchuimSurfer is designed to teach:

1. **Network Science Fundamentals**
   - Graph theory basics (nodes, edges, paths)
   - Centrality measures and their meanings
   - Community structure in networks

2. **Computational Social Science Methods**
   - Natural Language Processing (embeddings, similarity)
   - Statistical analysis (z-scores, outliers)
   - Temporal pattern detection

3. **Digital Forensics**
   - Bot detection techniques
   - Coordinated campaign identification
   - Evidence-based analysis

4. **Critical Media Literacy**
   - Understanding platform manipulation
   - Recognizing inauthentic behavior
   - Distinguishing organic vs. coordinated activity

### Use Cases

**Academic Research:**
- Study information operations
- Analyze social movements
- Investigate platform dynamics

**Journalism:**
- Verify grassroots authenticity
- Investigate manipulation campaigns
- Support investigative reporting

**Education:**
- Teach network analysis
- Demonstrate NLP applications
- Explore computational methods

**Platform Safety:**
- Understand threat models
- Test detection methods
- Develop countermeasures

### Ethical Considerations

⚠️ **Important Reminders:**

1. **Privacy:** Handle user data responsibly. Anonymize when sharing.
2. **Context Matters:** Coordination ≠ manipulation. Consider cultural/political context.
3. **Verification:** Always manually verify automated detections.
4. **Bias Awareness:** Algorithms can have biases. Understand limitations.
5. **Responsible Disclosure:** Don't publicly shame without evidence.

**Legitimate Coordination Exists:**
- Activist campaigns organize collectively
- Fan communities coordinate support
- Event promotion uses shared hashtags
- These are NOT inauthentic, just coordinated

---

## Tips & Best Practices

### Data Quality

✅ **Do:**
- Use complete, unfiltered datasets when possible
- Include diverse time ranges (weeks/months)
- Ensure consistent data formatting
- Document data sources and collection methods

❌ **Avoid:**
- Pre-filtered or sampled data (biases detection)
- Single-day snapshots (misses patterns)
- Mixed platform data without normalization
- Unknown provenance data

### Analysis Workflow

**Step 1: Explore**
- Load data and review statistics
- Check date range and user distribution
- Try different network types
- Identify obvious patterns

**Step 2: Filter**
- Remove spam/low-quality content (engagement filters)
- Focus on relevant time periods
- Narrow to active users if needed

**Step 3: Detect**
- Run community detection first (understand structure)
- Then run CIB detection (find anomalies)
- Adjust sensitivity based on results

**Step 4: Investigate**
- Click suspicious nodes for details
- Cross-reference multiple indicators
- Look for context clues in captions
- Verify with external sources

**Step 5: Document**
- Export network for reproducibility
- Screenshot findings with context
- Note parameter settings used
- Record limitations and uncertainties

### Common Pitfalls

**False Positives:**
- **Event coordination** (concerts, protests) looks like CIB
- **Brand campaigns** use templates legitimately
- **Time zones** affect synchronization interpretation
- **Cultural practices** vary (posting habits differ globally)

**False Negatives:**
- **Sophisticated actors** avoid obvious patterns
- **Slow campaigns** spread over time
- **Hybrid tactics** mix authentic and inauthentic
- **Platform-specific** methods may not transfer

**Mitigation:**
- Use multiple indicators (never rely on one)
- Consider domain knowledge (politics, culture, events)
- Validate with qualitative analysis (read posts)
- Consult experts when uncertain

---

## Technical Details

### Architecture

**Frontend:**
- Pure HTML/CSS/JavaScript (no build step)
- Client-side processing (privacy-preserving)
- WebGL for GPU-accelerated rendering

**Libraries:**
- **Transformers.js** (Xenova/all-MiniLM-L6-v2) - AI embeddings
- **Native Canvas/WebGL** - Visualization
- **No external frameworks** - Lightweight and portable

**Performance:**
- Handles 10,000+ nodes with GPU acceleration
- Adaptive rendering based on node count
- Spatial indexing for interaction
- Web Workers for heavy computation (future enhancement)

### Algorithms Implemented

1. **Louvain Community Detection**
   - Modularity optimization
   - Hierarchical clustering
   - O(n log n) complexity

2. **Force-Directed Layout**
   - Fruchterman-Reingold inspired
   - Adaptive cooling schedule
   - Barnes-Hut approximation (planned)

3. **Centrality Measures**
   - Degree, betweenness, closeness, eigenvector
   - Normalized scores (0-1)
   - Approximate algorithms for scale

4. **Semantic Similarity**
   - 384-dimensional embeddings
   - Cosine similarity metric
   - Batch processing for efficiency

### Browser Compatibility

**Recommended:**
- Chrome 90+ (best performance)
- Firefox 88+
- Edge 90+

**Required Features:**
- ES6+ JavaScript
- WebGL 2.0
- 4GB+ RAM for large datasets
- Modern CSS Grid/Flexbox

### Data Privacy

**Local Processing:**
- All computation happens in browser
- No data transmitted to servers
- No analytics or tracking
- No cookies or storage (session only)

**Security:**
- No eval() or unsafe operations
- Content Security Policy compatible
- XSS-safe rendering
- Input sanitization

---

## FAQ

**Q: How large of a dataset can SchuimSurfer handle?**  
A: Comfortably 10,000 posts with 1,000+ users. Larger datasets may slow down (use filters). GPU rendering helps significantly.

**Q: Is CIB detection 100% accurate?**  
A: No. It's a screening tool, not definitive proof. Always manually verify findings and consider context.

**Q: Can I use this with Twitter/X data?**  
A: Yes, but you'll need to adapt the data normalization function to match Twitter's JSON structure.

**Q: Why are some indicators marked with 🤖?**  
A: These use AI/machine learning (semantic similarity with neural networks). Others use statistical methods.

**Q: What does "SchuimSurfer" mean?**  
A: Dutch for "foam surfer" - a playful reference to surfing through the noise ("foam") of social media to find real signals.

**Q: Can this detect deepfakes or image manipulation?**  
A: No, SchuimSurfer focuses on behavioral patterns and text analysis, not media forensics.

**Q: Is this tool affiliated with any platform?**  
A: No, SchuimSurfer is independent research software, not affiliated with any social media company.

**Q: How do I cite this tool in research?**  
A: Include the repository URL and access date. Acknowledge the specific methods used (Louvain, Transformers.js, etc.).

---

## Troubleshooting

**Issue: "File won't load"**
- Check JSON formatting (use JSONLint)
- Ensure file size < 100MB
- Verify required fields exist
- Try a smaller sample first

**Issue: "Browser freezes with large dataset"**
- Enable GPU acceleration in browser settings
- Use engagement filters to reduce nodes
- Close other tabs (free memory)
- Try Chrome (best WebGL performance)

**Issue: "No communities detected"**
- Network may be too sparse (try different type)
- Increase edge weight threshold
- Check if data has enough connections
- Some networks naturally lack structure

**Issue: "CIB detection finds nothing"**
- Dataset may be genuinely organic
- Try lowering sensitivity threshold
- Use Advanced Settings to adjust parameters
- Check if data has required fields (timestamps, captions)

**Issue: "Everything is flagged as suspicious"**
- Sensitivity may be too high (adjust slider)
- Dataset may have coordination (not necessarily bad)
- Raise thresholds in Advanced Settings
- Consider context (events, campaigns)

---

## Contributing & Development

SchuimSurfer is a research and educational tool. Contributions are welcome!

**Potential Enhancements:**
- Additional network types (retweet, quote networks)
- More centrality algorithms (PageRank, HITS)
- Export options (PNG, SVG, GEXF)
- Comparative analysis (multiple datasets)
- Temporal network animation
- Multi-language support

**Research Extensions:**
- Bot detection ML models
- Narrative analysis
- Image content analysis (integration)
- Cross-platform linking
- Influence mapping

---

## Acknowledgments

**Academic Foundations:**
- Community Detection: Blondel et al. (Louvain algorithm)
- Semantic Similarity: Sentence Transformers (Reimers & Gurevych)
- Network Analysis: Newman, Barabási, Watts (graph theory)
- CIB Research: Stanford Internet Observatory, DFRLab, Graphika

**Technical Stack:**
- Transformers.js by Xenova
- WebGL rendering techniques from Three.js community
- Force-directed layout inspired by D3.js

**Inspiration:**
- Gephi, NodeXL, Hoaxy (network visualization tools)
- Botometer, BotSlayer (bot detection)
- CrowdTangle, Social Network Analysis platforms

---

## License & Citation

**License:** MIT License (see repository)

**Citation:**
```
SchuimSurfer: Social Media Network Analysis & CIB Detection Tool
[Repository URL]
Accessed: [Date]
```

**Academic Citation:**
```bibtex
@software{schuimsurfer,
  title = {SchuimSurfer: Educational CIB Detection and Network Analysis},
  author = {[Your Name]},
  year = {2024},
  url = {[Repository URL]}
}
```

---

## Contact & Support

For questions, bug reports, or collaboration:
- Open an issue on GitHub
- Email: [Your Contact]
- Twitter: [Your Handle]

**Educational Use:**
- Workshops and training sessions available
- Customization for specific research needs
- Integration support for institutional tools

---

## Appendix: Glossary

**Betweenness Centrality:** Measures how often a node lies on shortest paths between other nodes (bridges/brokers)

**Bot:** Automated account that posts content without human intervention

**CIB:** Coordinated Inauthentic Behavior - organized manipulation violating platform policies

**Clustering Coefficient:** Measures how connected a node's neighbors are to each other (local density)

**Community:** Dense subgroup within a network with more internal than external connections

**Cosine Similarity:** Measures angle between vectors; 1 = identical, 0 = orthogonal, -1 = opposite

**Degree Centrality:** Number of direct connections a node has (popularity)

**Eigenvector Centrality:** Measures influence based on connection to other influential nodes

**Engagement Pod:** Group that artificially boosts each other's metrics through coordinated engagement

**Jaccard Similarity:** Size of intersection divided by size of union (overlap measure)

**Levenshtein Distance:** Minimum edits needed to transform one string into another

**Modularity:** Quality metric for community structure; high = well-defined communities

**N-gram:** Sequence of N words (5-gram = sequence of 5 words)

**Semantic Similarity:** Meaning-based similarity (vs. text-based); uses AI embeddings

**TF-IDF:** Term Frequency-Inverse Document Frequency; weighs importance by rarity

**Z-Score:** Number of standard deviations from mean; measures how unusual a value is

---

**Happy Surfing! 🏄‍♂️**

*Remember: Use this tool ethically, verify findings carefully, and always consider context. Coordination ≠ inauthenticity.*

