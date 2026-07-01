package dget

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/docker/distribution/manifest/manifestlist"
	"github.com/opencontainers/go-digest"
	"github.com/pkg/errors"
	"github.com/sirupsen/logrus"
)

// const _registry = "registry-1.docker.io"
const _authUrl = "https://auth.docker.io/token"
const _regService = "registry.docker.io"

type LayerInfo struct {
	Id              string    `json:"id"`
	Parent          string    `json:"parent"`
	Created         time.Time `json:"created"`
	ContainerConfig struct {
		Hostname     string
		Domainname   string
		User         string
		AttachStdin  bool
		AttachStdout bool
		AttachStderr bool
		Tty          bool
		OpenStdin    bool
		StdinOnce    bool
		Env          []string
		CMd          []string
		Image        string
		Volumes      map[string]interface{}
		WorkingDir   string
		Entrypoint   []string
		OnBuild      []string
		Labels       map[string]interface{}
	} `json:"container_config"`
}

type Layer struct {
	Digest string
	Urls   []string
}

type Info struct {
	Layers []Layer `json:"layers"`
	Config struct {
		Digest digest.Digest `json:"digest,omitempty"`
	} `json:"config"`
}

type PackageConfig struct {
	Config   string
	RepoTags []string
	Layers   []string
}

type Client struct {
	c                *http.Client
	progressCallback func(progress float64) // 下载阶段进度回调
	packageCallback  func(progress float64) // 打包tar.gz阶段进度回调
	// 全局下载进度聚合器（多层并发时按全局已读/全局总算百分比，单调递增不跳跃）
	globalRead   int64 // 原子累加：所有层已读字节数（增量上报）
	globalTotal  int64 // 原子累加：所有层总字节数（从Content-Length获取）
	lastEmitTime int64 // 上次发送进度事件的时间戳(ms)，用于节流
}

// ProgressReader 进度跟踪reader包装器
type ProgressReader struct {
	r        io.Reader
	total    int64
	read     int64
	callback func(progress float64) // per-layer百分比回调（向后兼容）
	onBytes  func(n int)            // 新增：本次读取字节数上报给全局聚合器
}

// Read 实现io.Reader接口，同时跟踪读取进度
func (pr *ProgressReader) Read(p []byte) (n int, err error) {
	n, err = pr.r.Read(p)
	pr.read += int64(n)
	// 全局聚合：把本次读取字节数上报给聚合器（增量累加，并发安全）
	if pr.onBytes != nil && n > 0 {
		pr.onBytes(n)
	}
	if pr.total > 0 && pr.callback != nil {
		progress := float64(pr.read) / float64(pr.total) * 100
		// 钳制到0~100：total取自Content-Length(压缩后大小)，而read是gzip解压后字节数，
		// 压缩比会导致read>total从而progress>100，必须钳制避免前端进度超过100%
		if progress > 100 {
			progress = 100
		}
		pr.callback(progress)
	}
	return
}

type TagList struct {
	Name string
	Tags []string
}

type SyncSignal struct{}

func (m *Client) SetClient(c *http.Client) {
	m.c = c
}

// SetProgressCallback 设置下载进度回调函数
func (m *Client) SetProgressCallback(callback func(progress float64)) {
	m.progressCallback = callback
}

// SetPackageCallback 设置打包tar.gz阶段的进度回调函数
func (m *Client) SetPackageCallback(callback func(progress float64)) {
	m.packageCallback = callback
}

// InstallWithTargetDir 使用指定的目标目录安装镜像
func (m *Client) InstallWithTargetDir(syncCount int, _registry, d, tag string, arch string, printInfo bool, onlyGetTag bool, username string, password string, targetDir string) (err error) {
	// 重置全局进度聚合器，确保本次下载从0开始统计
	atomic.StoreInt64(&m.globalRead, 0)
	atomic.StoreInt64(&m.globalTotal, 0)
	atomic.StoreInt64(&m.lastEmitTime, 0)
	var authUrl = _authUrl
	var regService = _regService
	resp, err := m.c.Get(fmt.Sprintf("https://%s/v2/", _registry))
	if err == nil {
		if !strings.Contains(d, "/") {
			d = "library/" + d
		}
		if resp.StatusCode == 401 {
			//Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
			var hAuths = strings.Split(resp.Header.Get("Www-Authenticate"), "\"")
			logrus.Debugln("Www-Authenticate", hAuths)
			if len(hAuths) > 1 {
				authUrl = hAuths[1]
			}
			if len(hAuths) > 3 {
				regService = hAuths[3]
			} else {
				regService = _registry
			}
		}
		resp.Body.Close()
		var accessToken string
		logrus.Debugln("reg_service", regService)
		logrus.Debugln("authUrl", authUrl)

		if username != "" && password != "" {
			accessToken, err = m.getTokenWithBasicAuth(authUrl, regService, d, username, password)
		} else {
			accessToken, err = m.getAuthHead(authUrl, regService, d)
		}

		if err == nil {

			var req *http.Request

			if onlyGetTag {
				var tagListURL = fmt.Sprintf("https://%s/v2/%s/tags/list", _registry, d)
				logrus.Debugln("tags request", tagListURL)

				req, err = http.NewRequest("GET", tagListURL, nil)
				if err == nil {
					req.Header.Add("Authorization", "Bearer "+accessToken)
					resp, err = m.c.Do(req)
					if err == nil && resp.StatusCode == 200 {
						var bts []byte
						bts, err = io.ReadAll(resp.Body)
						logrus.Debugln("tags response", string(bts))
						if err == nil {
							var tagList TagList
							err = json.Unmarshal(bts, &tagList)

							if err == nil && len(tagList.Tags) > 0 {
								tag = tagList.Tags[0]
								fmt.Println("获取到的tag列表为:")
								fmt.Println(strings.Join(tagList.Tags, ","))
								return
							}
						}
						resp.Body.Close()
					}
				}
			}

			var manifestURL = fmt.Sprintf("https://%s/v2/%s/manifests/%s", _registry, d, tag)
			req, err = http.NewRequest("GET", manifestURL, nil)
			logrus.Infoln("获取manifests信息", manifestURL)
			if err == nil {
				logrus.Debugln("Authorization by", accessToken)
				req.Header.Add("Authorization", "Bearer "+accessToken)
				// req.Header.Add("Accept", "application/vnd.oci.image.manifest.v1+json")
				req.Header.Add("Accept", "application/vnd.docker.distribution.manifest.list.v2+json")
				req.Header.Add("Accept", "application/vnd.oci.image.index.v1+json")

				var authHeader = req.Header

				resp, err = m.c.Do(req)
				if resp.StatusCode != 200 {
					bts, er := io.ReadAll(resp.Body)
					resp.Body.Close()
					logrus.Debugln(string(bts), er)
					switch resp.StatusCode {
					case 401:
						logrus.Errorf("[-] Cannot fetch manifest for %s [HTTP %d] with error access_token", d, resp.StatusCode)
					case 404:
						logrus.Errorf("[-] Cannot fetch manifest for %s [HTTP %d] with url %s", d, resp.StatusCode, manifestURL)
						resp.Body.Close()
						req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.list.v2+json")
						resp, err = m.c.Do(req)
						bts, er := ioutil.ReadAll(resp.Body)
						fmt.Println(string(bts), er)
					}
					//TODO

					os.Exit(1)
				} else {
					var bts []byte
					bts, err = io.ReadAll(resp.Body)

					if err == nil {
						logrus.WithField("Content-Type", resp.Header.Get("Content-Type")).Debugln("Get manifest list")
						switch resp.Header.Get("Content-Type") {
						case "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.oci.image.index.v1+json":
							var info manifestlist.ManifestList
							err = json.Unmarshal(bts, &info)

							if err == nil {
								resp.Body.Close()

								logrus.Infof("获得%d个架构信息:", len(info.Manifests))

								var selectedManifest *manifestlist.ManifestDescriptor
								for i := 0; i < len(info.Manifests); i++ {
									var m = info.Manifests[i]
									logrus.Infof("[%d]架构:%s,OS:%s", i+1, m.Platform.Architecture, m.Platform.OS)
									if m.Platform.OS+"/"+m.Platform.Architecture == arch {
										logrus.Infoln("找到匹配的架构,开始下载")
										selectedManifest = &m
										req.URL, _ = url.Parse(fmt.Sprintf("https://%s/v2/%s/manifests/%s", _registry, d, m.Digest.String()))
										break
									}
								}
								if printInfo {
									fmt.Println(string(bts))
									os.Exit(0)
								}

								if selectedManifest == nil {
									return errors.New("未找到匹配的架构:" + arch)
								}

								logrus.Debug("找到的架构信息为", selectedManifest)
								req.Header.Set("Accept", selectedManifest.MediaType)
							}
						case "application/vnd.docker.distribution.manifest.v1+prettyjws":
							req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json")
						}

						resp, err = m.c.Do(req)

						if err == nil {

							var info Info
							err = json.NewDecoder(resp.Body).Decode(&info)

							if err == nil {
								resp.Body.Close()
								logrus.Infof("获得Manifest信息，共%d层需要下载", len(info.Layers))

								err = m.downloadWithTargetDir(syncCount, _registry, d, tag, info.Config.Digest, authHeader, info.Layers, targetDir)

								if err != nil {
									goto response
								}
							}
						}
					}
				}
			}
		}
	}
response:
	return
}

func (m *Client) getTokenWithBasicAuth(url, service, repository, username, password string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, url, http.NoBody)
	if err != nil {
		logrus.Fatal(err)
		return "", err
	}
	req.SetBasicAuth(username, password)

	query := req.URL.Query()
	query.Add("service", service)
	query.Add("scope", fmt.Sprintf("repository:%s:pull", repository))
	req.URL.RawQuery = query.Encode()
	resp, err := m.c.Do(req)
	if err == nil {
		defer resp.Body.Close()
		var results map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&results)
		logrus.Debug(results)
		if err == nil && results["token"] != nil {
			return results["token"].(string), nil
		}
	}
	return "", err
}

// downloadWithTargetDir 使用指定的目标目录下载镜像
func (m *Client) downloadWithTargetDir(syncCount int, _registry, d, tag string, digest digest.Digest, authHeader http.Header, layers []Layer, targetDir string) (err error) {
	// 使用指定的目标目录作为工作目录，而不是创建临时目录
	err = os.MkdirAll(targetDir, 0777)
	if err == nil {
		if _, e := os.Stat(filepath.Join(targetDir, "repositories")); e == nil {
			logrus.Info(targetDir, " is downloaded,use dir as cache")
		} else {
			var req *http.Request
			req, err = http.NewRequest("GET", fmt.Sprintf("https://%s/v2/%s/blobs/%s", _registry, d, digest), nil)
			if err == nil {
				req.Header = authHeader
				var resp *http.Response
				resp, err = m.c.Do(req)
				if err == nil {
					var dest *os.File
					dest, err = os.OpenFile(filepath.Join(targetDir, digest.Encoded()+".json"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
					if err == nil {
						var bts []byte
						bts, err = ioutil.ReadAll(resp.Body)
						var lastLayerInfo LayerInfo
						err = json.Unmarshal(bts, &lastLayerInfo)
						resp.Body.Close()

						var config []PackageConfig
						config = append(config, PackageConfig{
							Config:   digest.Encoded() + ".json",
							RepoTags: []string{_registry + "/" + d + ":" + tag},
						})
						if err == nil {
							_, err = io.Copy(dest, bytes.NewReader(bts))
							dest.Close()
							if err == nil {
								parentid := ""
								var fakeLayerId string
								var downloadStatus = make(map[int]bool)
								var notifyChan = make(chan int, 1)
								//限制并发下载数为3
								var ch = make(chan SyncSignal, syncCount)
								for n, layer := range layers {
									namer := sha256.New()
									namer.Write([]byte(parentid + "\n" + layer.Digest + "\n"))
									fakeLayerId = hex.EncodeToString(namer.Sum(nil))
									logrus.Infoln("handle layer", n, fakeLayerId, layer.Urls)

									var layerInfo LayerInfo
									if n == len(layers)-1 {
										layerInfo = lastLayerInfo
									}
									layerInfo.Id = fakeLayerId
									if parentid != "" {
										layerInfo.Parent = parentid
									}

									config[0].Layers = append(config[0].Layers, fakeLayerId+"/layer.tar")
									var copyedHeader = make(http.Header)
									for k, v := range authHeader {
										copyedHeader[k] = v
									}
									go func(fakeLayerId string, layer Layer, n int, notifyChan chan int, layerInfo *LayerInfo, targetDir string, _registry string, d string, authHeader http.Header) {
										ch <- SyncSignal{}
										er := m.downloadLayer(fakeLayerId, &layer, layerInfo, targetDir, _registry, d, authHeader)
										if er != nil {
											logrus.Errorf("下载第%d/%d层失败:%s", n+1, len(layers), err)
											err = er
										}
										notifyChan <- n
										<-ch
									}(fakeLayerId, layer, n, notifyChan, &layerInfo, targetDir, _registry, d, copyedHeader)
									parentid = fakeLayerId
								}

								for len(downloadStatus) < len(layers) {
									n := <-notifyChan
									downloadStatus[n] = true
									if len(downloadStatus) == len(layers) {
										close(notifyChan)
										logrus.Infof("[%d/%d]下载完成", len(downloadStatus), len(layers))
										break
									} else {
										logrus.Infof("[%d/%d]第%d层下载完成", len(downloadStatus), len(layers), n+1)
									}
								}

								if err != nil {
									return err
								}

								var manifest *os.File
								logrus.Debugln("write manifest to", filepath.Join(targetDir, "manifest.json"))
								manifest, err = os.OpenFile(filepath.Join(targetDir, "manifest.json"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
								if err == nil {
									err = json.NewEncoder(manifest).Encode(&config)
									if err == nil {
										manifest.Close()
										var repositories = make(map[string]interface{})
										repositories[_registry+"/"+d] = map[string]string{
											tag: fakeLayerId,
										}
										var rFile *os.File
										rFile, err = os.OpenFile(filepath.Join(targetDir, "repositories"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
										if err == nil {
											err = json.NewEncoder(rFile).Encode(&repositories)
											logrus.Debugln("write repositories to", filepath.Join(targetDir, "repositories"))
											goto maketar
										}
									}
								}
								logrus.Debugln("write manifest fail", err)

							}
						}
					}
				}
			}

		}
	maketar:
		if err == nil {
			// 直接在目标目录中创建tar.gz文件
			tarPath := targetDir + ".tar.gz"
			err = writeDirToTarGz(targetDir, tarPath, m.packageCallback)
			if err == nil {
				fmt.Println("write tar success", tarPath)
			} else {
				logrus.Debugln("write tar fail", err)
			}
		}
	}
	return
}

// 原始的download方法，保持向后兼容
func (m *Client) download(syncCount int, _registry, d, tag string, digest digest.Digest, authHeader http.Header, layers []Layer) (err error) {
	var tmpDir = fmt.Sprintf("tmp_%s_%s", d, tag)
	err = os.MkdirAll(tmpDir, 0777)
	if err == nil {
		if _, e := os.Stat(filepath.Join(tmpDir, "repositories")); e == nil {
			logrus.Info(tmpDir, " is downloaded,use dir as cache")
		} else {
			var req *http.Request
			req, err = http.NewRequest("GET", fmt.Sprintf("https://%s/v2/%s/blobs/%s", _registry, d, digest), nil)
			if err == nil {
				req.Header = authHeader
				var resp *http.Response
				resp, err = m.c.Do(req)
				if err == nil {
					var dest *os.File
					dest, err = os.OpenFile(filepath.Join(tmpDir, digest.Encoded()+".json"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
					if err == nil {
						var bts []byte
						bts, err = ioutil.ReadAll(resp.Body)
						var lastLayerInfo LayerInfo
						err = json.Unmarshal(bts, &lastLayerInfo)
						resp.Body.Close()

						var config []PackageConfig
						config = append(config, PackageConfig{
							Config:   digest.Encoded() + ".json",
							RepoTags: []string{_registry + "/" + d + ":" + tag},
						})
						if err == nil {
							_, err = io.Copy(dest, bytes.NewReader(bts))
							dest.Close()
							if err == nil {
								parentid := ""
								var fakeLayerId string
								var downloadStatus = make(map[int]bool)
								var notifyChan = make(chan int, 1)
								//限制并发下载数为3
								var ch = make(chan SyncSignal, syncCount)
								for n, layer := range layers {
									namer := sha256.New()
									namer.Write([]byte(parentid + "\n" + layer.Digest + "\n"))
									fakeLayerId = hex.EncodeToString(namer.Sum(nil))
									logrus.Infoln("handle layer", n, fakeLayerId, layer.Urls)

									var layerInfo LayerInfo
									if n == len(layers)-1 {
										layerInfo = lastLayerInfo
									}
									layerInfo.Id = fakeLayerId
									if parentid != "" {
										layerInfo.Parent = parentid
									}

									config[0].Layers = append(config[0].Layers, fakeLayerId+"/layer.tar")
									var copyedHeader = make(http.Header)
									for k, v := range authHeader {
										copyedHeader[k] = v
									}
									go func(fakeLayerId string, layer Layer, n int, notifyChan chan int, layerInfo *LayerInfo, tmpDir string, _registry string, d string, authHeader http.Header) {
										ch <- SyncSignal{}
										er := m.downloadLayer(fakeLayerId, &layer, layerInfo, tmpDir, _registry, d, authHeader)
										if er != nil {
											logrus.Errorf("下载第%d/%d层失败:%s", n+1, len(layers), err)
											err = er
										}
										notifyChan <- n
										<-ch
									}(fakeLayerId, layer, n, notifyChan, &layerInfo, tmpDir, _registry, d, copyedHeader)
									parentid = fakeLayerId
								}

								for len(downloadStatus) < len(layers) {
									n := <-notifyChan
									downloadStatus[n] = true
									if len(downloadStatus) == len(layers) {
										close(notifyChan)
										logrus.Infof("[%d/%d]下载完成", len(downloadStatus), len(layers))
										break
									} else {
										logrus.Infof("[%d/%d]第%d层下载完成", len(downloadStatus), len(layers), n+1)
									}
								}

								if err != nil {
									return err
								}

								var manifest *os.File
								logrus.Debugln("write manifest to", filepath.Join(tmpDir, "manifest.json"))
								manifest, err = os.OpenFile(filepath.Join(tmpDir, "manifest.json"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
								if err == nil {
									err = json.NewEncoder(manifest).Encode(&config)
									if err == nil {
										manifest.Close()
										var repositories = make(map[string]interface{})
										repositories[_registry+"/"+d] = map[string]string{
											tag: fakeLayerId,
										}
										var rFile *os.File
										rFile, err = os.OpenFile(filepath.Join(tmpDir, "repositories"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
										if err == nil {
											err = json.NewEncoder(rFile).Encode(&repositories)
											logrus.Debugln("write repositories to", filepath.Join(tmpDir, "repositories"))
											goto maketar
										}
									}
								}
								logrus.Debugln("write manifest fail", err)

							}
						}
					}
				}
			}

		}
	maketar:
		if err == nil {
			err = writeDirToTarGz(tmpDir, tmpDir+"-img.tar.gz", m.packageCallback)
			if err == nil {
				fmt.Println("write tar success", tmpDir+"-img.tar.gz")
			} else {
				logrus.Debugln("write tar fail", err)
			}
			os.RemoveAll(tmpDir)
		}
	}
	return
}

func (m *Client) getAuthHead(a, r, d string) (string, error) {
	var regUrl = fmt.Sprintf("%s?service=%s&scope=repository:%s:pull", a, r, d)
	logrus.Debug("get auth head from ", regUrl)
	resp, err := m.c.Get(regUrl)
	if err == nil {
		defer resp.Body.Close()
		var results map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&results)
		logrus.Debug(results)
		if err == nil {
			var accessToken string
			if results["access_token"] != nil {
				accessToken = results["access_token"].(string)
			} else if results["token"] != nil {
				accessToken = results["token"].(string)
			}
			if accessToken != "" {
				return accessToken, nil
			}
			return "", errors.New("access_token is empty")
		}
	}
	return "", err
}

func writeDirToTarGz(sourcedir, destinationfile string, progressCallback func(progress float64)) error {
	// create tar file
	gzFile, err := os.Create(destinationfile)
	gf := gzip.NewWriter(gzFile)
	tw := tar.NewWriter(gf)
	logrus.Debug("write tgz file to ", destinationfile)
	if err == nil {

		defer func() {
			tw.Close()
			gf.Close()
			gzFile.Close()
		}()

		// 预扫描统计总字节数（仅在有回调时），用于精确字节进度
		var totalBytes, writtenBytes int64
		if progressCallback != nil {
			filepath.Walk(sourcedir, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				if !info.IsDir() {
					totalBytes += info.Size()
				}
				return nil
			})
			progressCallback(0)
		}

		walkErr := filepath.Walk(sourcedir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			relPath, err := filepath.Rel(sourcedir, path)
			if err == nil && relPath != "." {
				logrus.Debugln("write", relPath)
				header, err := tar.FileInfoHeader(info, path)
				if err != nil {
					return err
				}

				// must provide real name
				// (see https://golang.org/src/archive/tar/common.go?#L626)
				header.Name = filepath.ToSlash(relPath)

				// write header
				if err := tw.WriteHeader(header); err != nil {
					return err
				}
				// if not a dir, write file content
				if !info.IsDir() {
					data, err := os.Open(path)
					if err != nil {
						return err
					}
					defer data.Close()

					// 有回调时分块读写并累加字节数，精确推进度；无回调时走原 io.Copy 路径
					if progressCallback != nil {
						buf := make([]byte, 256*1024)
						var lastEmit int64 // 上次发送进度的时间戳(ms)，500ms节流
						for {
							nr, er := data.Read(buf)
							if nr > 0 {
								nw, ew := tw.Write(buf[:nr])
								writtenBytes += int64(nw)
								// 500ms节流：避免打包阶段也刷屏
								if totalBytes > 0 {
									now := time.Now().UnixMilli()
									if now-lastEmit >= 500 {
										lastEmit = now
										progressCallback(float64(writtenBytes) / float64(totalBytes) * 100)
									}
								}
								if ew != nil {
									return ew
								}
							}
							if er == io.EOF {
								break
							}
							if er != nil {
								return er
							}
						}
					} else {
						if _, err := io.Copy(tw, data); err != nil {
							return err
						}
					}
				}
				return nil
			}
			return err
		})

		// 打包完成后回调100%
		if walkErr == nil && progressCallback != nil {
			progressCallback(100)
		}
		return walkErr
	}
	return err
}

func SetLogLevel(lvl logrus.Level) {
	logrus.SetLevel(lvl)
	logrus.Debugln("设置日志级别为", lvl)
}

func (m *Client) downloadLayer(fakeLayerId string, layer *Layer, layerInfo *LayerInfo, tmpDir string, _registry string, d string, authHeader http.Header) error {
	layerDirName := filepath.Join(tmpDir, fakeLayerId)
	err := os.Mkdir(layerDirName, 0777)
	if _, er := os.Stat(filepath.Join(layerDirName, "layer.tar")); er == nil {
		logrus.Infoln("layer", fakeLayerId, "is existed, continue")
		return nil
	}
	if err == nil || os.IsExist(err) {
		err = ioutil.WriteFile(filepath.Join(layerDirName, "VERSION"), []byte("1.0"), 0666)
		if err == nil {
			var req *http.Request
			req, err = http.NewRequest("GET", fmt.Sprintf("https://%s/v2/%s/blobs/%s", _registry, d, layer.Digest), nil)
			if err == nil {
				req.Header = authHeader
				req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json")
				var resp *http.Response
				resp, err = m.c.Do(req)
				if err == nil {
					if resp.StatusCode != 200 {
						defer resp.Body.Close()
						if len(layer.Urls) > 0 {
							req, err = http.NewRequest("GET", layer.Urls[0], nil)
							if err == nil {
								req.Header = authHeader
								req.Header.Set("Accept", "application/vnd.docker.distribution.manifest.v2+json")
								resp, err = m.c.Do(req)
								if err == nil {
									if resp.StatusCode != 200 {
										err = fmt.Errorf("download from customized url fail")
										return err
									}
								}
							}
						} else {
							bts, _ := ioutil.ReadAll(resp.Body)
							logrus.Fatalln("下载失败", string(bts))
						}
					}
				}
				if err != nil {
					return errors.Wrap(err, "请求失败")
				}
				var dst *os.File
				dst, err = os.OpenFile(filepath.Join(layerDirName, "layer.tar.part"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
				if err == nil {
					var greader *gzip.Reader
					greader, err = gzip.NewReader(resp.Body)
					if err == nil {
						// 获取文件总大小
						totalSize, _ := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)

						// 注册本层总大小到全局聚合器（原子累加，多层并发安全）
						atomic.AddInt64(&m.globalTotal, totalSize)

						// 创建进度跟踪reader：onBytes 上报本次读取字节数到全局聚合器，
						// 按 globalRead/globalTotal 算全局百分比并200ms节流回调，避免per-layer 0~100反复跳和刷屏
						pr := &ProgressReader{
							r:     greader,
							total: totalSize,
							onBytes: func(n int) {
								atomic.AddInt64(&m.globalRead, int64(n))
								// 时间节流：距上次发送≥200ms才回调
								now := time.Now().UnixMilli()
								last := atomic.LoadInt64(&m.lastEmitTime)
								if now-last >= 200 {
									if atomic.CompareAndSwapInt64(&m.lastEmitTime, last, now) {
										total := atomic.LoadInt64(&m.globalTotal)
										read := atomic.LoadInt64(&m.globalRead)
										if total > 0 && m.progressCallback != nil {
											p := float64(read) / float64(total) * 100
											if p > 100 {
												p = 100
											}
											m.progressCallback(p)
										}
									}
								}
							},
						}

						// 使用进度跟踪reader进行复制
						_, err = io.Copy(dst, pr)
						if err == nil {
							dst.Close()
							var jsonFile *os.File
							jsonFile, err = os.OpenFile(filepath.Join(layerDirName, "json"), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0666)
							if err == nil {
								err = json.NewEncoder(jsonFile).Encode(layerInfo)
								if err == nil {
									jsonFile.Close()
									err = os.Rename(filepath.Join(layerDirName, "layer.tar.part"), filepath.Join(layerDirName, "layer.tar"))
								}
							}
						}
					}
				}
				if err != nil {
					err = errors.Wrap(err, "下载失败")
				}
				return err
			}
		}
	}
	return err
}
