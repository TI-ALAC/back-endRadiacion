
        const API_URL = 'https://alacradiation.alacoohperu.pe/api'; // Cambia por tu URL de API
        
        // Función para clasificar UV y obtener color
        function clasificarUV(indice) {
            if (indice <= 2) return { nivel: 'Bajo', color: '#28a745' };
            if (indice <= 5) return { nivel: 'Moderado', color: '#ffc107' };
            if (indice <= 7) return { nivel: 'Alto', color: '#fd7e14' };
            if (indice <= 10) return { nivel: 'Muy Alto', color: '#dc3545' };
            return { nivel: 'Extremo', color: '#6f42c1' };
        }

        // Función para animar la barra UV
        function animarBarraUV(indice) {
            const fill = document.getElementById('uvFill');
            const value = document.getElementById('uvValue');
            const level = document.getElementById('uvLevel');
            
            // Calcular porcentaje (máximo 15 para la escala visual)
            const porcentaje = Math.min((indice / 15) * 100, 100);
            
            // Clasificar UV
            const clasificacion = clasificarUV(indice);
            
            // Resetear valores
            value.textContent = '0.0';
            fill.style.width = '0%';
            
            // Animar valor y barra simultáneamente
            let valorActual = 0;
            let porcentajeActual = 0;
            const valorFinal = indice;
            const porcentajeFinal = porcentaje;
            const duracion = 2000; // 2 segundos
            const pasos = 40; // Número de pasos en la animación
            const intervalo = duracion / pasos;
            const incrementoValor = valorFinal / pasos;
            const incrementoPorcentaje = porcentajeFinal / pasos;
            
            let paso = 0;
            const animacion = setInterval(() => {
                paso++;
                valorActual = (incrementoValor * paso);
                porcentajeActual = (incrementoPorcentaje * paso);
                
                // Asegurar que no se pasen de los valores finales
                if (paso >= pasos) {
                    valorActual = valorFinal;
                    porcentajeActual = porcentajeFinal;
                    clearInterval(animacion);
                }
                
                // Actualizar ambos valores al mismo tiempo
                value.textContent = valorActual.toFixed(1);
                fill.style.width = porcentajeActual + '%';
                
                // Actualizar color del nivel gradualmente
                if (paso === pasos) {
                    level.textContent = clasificacion.nivel;
                    level.style.backgroundColor = clasificacion.color;
                }
            }, intervalo);
        }

        // Función para obtener radiación de la API
        async function obtenerRadiacion() {
            const lat = document.getElementById('latInput').value;
            const lng = document.getElementById('lngInput').value;
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const coordinates = document.getElementById('coordinates');
            
            if (!lat || !lng) {
                mostrarError('Por favor ingresa latitud y longitud válidas');
                return;
            }
            
            // Mostrar loading
            loading.style.display = 'block';
            error.style.display = 'none';
            
            try {
                const response = await fetch(`${API_URL}/radiacion?lat=${lat}&lng=${lng}`);
                
                if (!response.ok) {
                    throw new Error(`Error ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }
                console.log("data",data)
                // Animar barra con el índice UV obtenido
                animarBarraUV(data.uv.indice);
                
                // Mostrar alertas si las hay
                if (data.alertas && data.alertas.length > 0) {
                    mostrarAlertas(data.alertas);
                } else {
                    // Mostrar mensaje de éxito si hay datos reales
                    if (data.uv.fuente_real || data.radiacion_solar.fuente_real) {
                        mostrarAlertas([{
                            tipo: 'success',
                            mensaje: 'Datos en tiempo real',
                            detalle: `Conectado exitosamente a CurrentUVIndex API`
                        }]);
                    }
                }
                
                // Actualizar coordenadas
                let statusIcon = '📡';
                let statusText = '';
                
                if (data.precision === 'Alta (datos en tiempo real)') {
                    statusIcon = '✅';
                    statusText = 'Datos en tiempo real';
                } else if (data.precision === 'Media (datos SENAMHI)') {
                    statusIcon = '⚠️';
                    statusText = 'Datos SENAMHI';
                } else {
                    statusIcon = '⚠️';
                    statusText = 'Datos estimados';
                }
                
                coordinates.innerHTML = `
                    📍 Lat: ${data.coordenadas.lat}, Lng: ${data.coordenadas.lng} • 
                    🏔️ ${data.coordenadas.altitud}m • 
                    🕒 ${data.hora_local} • 
                    ${statusIcon} ${statusText}
                `;
                
            } catch (error) {
                console.error('Error:', error);
                
                // Mostrar alerta de error de conexión
                mostrarAlertas([{
                    tipo: 'error',
                    mensaje: 'Error de conexión con la API',
                    detalle: `${error.message}. Usando datos simulados como alternativa.`
                }]);
                
                // Usar datos simulados como fallback
                const uvSimulado = simularUV(parseFloat(lat), parseFloat(lng));
                animarBarraUV(uvSimulado);
                coordinates.innerHTML = `📍 Lat: ${lat}, Lng: ${lng} • ⚠️ Datos simulados (API no disponible)`;
                
            } finally {
                loading.style.display = 'none';
            }
        }

        // Función para simular UV cuando la API no está disponible
        function simularUV(lat, lng) {
            const hora = new Date().getHours();
            const factorHora = Math.max(0, Math.sin(Math.PI * (hora - 6) / 12));
            const factorLatitud = 1 - (Math.abs(lat) / 90) * 0.4;
            const uvBase = 12;
            const uv = uvBase * factorLatitud * factorHora;
            return Math.round(Math.max(0, uv) * 10) / 10;
        }

        // Función para mostrar alertas
        function mostrarAlertas(alertas) {
            const container = document.getElementById('alertsContainer');
            container.innerHTML = '';
            
            if (!alertas || alertas.length === 0) {
                return;
            }
            
            alertas.forEach(alerta => {
                const alertDiv = document.createElement('div');
                alertDiv.className = `alert alert-${alerta.tipo}`;
                
                // Iconos según tipo
                const iconos = {
                    error: '🔴',
                    warning: '⚠️',
                    info: 'ℹ️',
                    success: '✅'
                };
                
                alertDiv.innerHTML = `
                    <div class="alert-icon">${iconos[alerta.tipo] || '📢'}</div>
                    <div class="alert-content">
                        <div class="alert-title">${alerta.mensaje}</div>
                        <div class="alert-detail">${alerta.detalle}</div>
                    </div>
                `;
                
                container.appendChild(alertDiv);
            });
            
            // Auto-ocultar alertas info después de 10 segundos
            setTimeout(() => {
                const alertasInfo = container.querySelectorAll('.alert-info');
                alertasInfo.forEach(alert => {
                    alert.style.transition = 'opacity 0.5s ease';
                    alert.style.opacity = '0';
                    setTimeout(() => {
                        if (alert.parentNode) {
                            alert.remove();
                        }
                    }, 500);
                });
            }, 10000);
        }

        // Función para mostrar errores
        function mostrarError(mensaje) {
            const error = document.getElementById('error');
            error.textContent = mensaje;
            error.style.display = 'block';
            setTimeout(() => {
                error.style.display = 'none';
            }, 5000);
        }

        // Función para usar ubicación actual
        function usarUbicacionActual() {
            if (!navigator.geolocation) {
                mostrarError('Geolocalización no es soportada por este navegador');
                return;
            }
            
            const loading = document.getElementById('loading');
            loading.style.display = 'block';
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude.toFixed(4);
                    const lng = position.coords.longitude.toFixed(4);
                    
                    document.getElementById('latInput').value = lat;
                    document.getElementById('lngInput').value = lng;
                    
                    loading.style.display = 'none';
                    obtenerRadiacion();
                },
                (error) => {
                    loading.style.display = 'none';
                    mostrarError('Error obteniendo ubicación: ' + error.message);
                },
                { timeout: 10000, enableHighAccuracy: true }
            );
        }

        // Función para ver pronóstico
        async function verPronostico() {
            const lat = document.getElementById('latInput').value;
            const lng = document.getElementById('lngInput').value;
            const loading = document.getElementById('loading');
            const pronosticoContainer = document.getElementById('pronosticoContainer');
            const pronosticoContent = document.getElementById('pronosticoContent');
            
            if (!lat || !lng) {
                mostrarError('Por favor ingresa latitud y longitud válidas');
                return;
            }
            
            loading.style.display = 'block';
            pronosticoContainer.style.display = 'none';
            
            try {
                const response = await fetch(`${API_URL}/pronostico?lat=${lat}&lng=${lng}`);
                
                if (!response.ok) {
                    throw new Error(`Error ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }
                
                // Mostrar pronóstico
                let html = '<div class="pronostico-grid">';
                
                // Mostrar las próximas 12 horas
                const horasAMostrar = data.pronostico_horas.slice(0, 12);
                
                horasAMostrar.forEach(hora => {
                    html += `
                        <div class="pronostico-hora">
                            <div class="pronostico-tiempo">${hora.hora}</div>
                            <div class="pronostico-uv" style="color: ${hora.color}">${hora.uv}</div>
                            <div class="pronostico-nivel" style="background-color: ${hora.color}">${hora.nivel}</div>
                        </div>
                    `;
                });
                
                html += '</div>';
                
                // Resumen por días
                if (data.pronostico_dias && data.pronostico_dias.length > 0) {
                    html += '<h4 style="margin-top: 20px; color: #333;">📅 Resumen por días (UV máximo)</h4>';
                    html += '<div style="margin-top: 10px;">';
                    
                    data.pronostico_dias.forEach(dia => {
                        const clasificacion = clasificarUV(dia.uv_maximo);
                        html += `
                            <div style="padding: 10px; margin: 5px 0; background: rgba(255,255,255,0.8); border-radius: 10px; display: flex; justify-content: space-between; align-items: center;">
                                <span><strong>${dia.fecha}</strong></span>
                                <span style="color: ${clasificacion.color}; font-weight: bold;">UV ${dia.uv_maximo} - ${clasificacion.nivel}</span>
                            </div>
                        `;
                    });
                    
                    html += '</div>';
                }
                
                pronosticoContent.innerHTML = html;
                pronosticoContainer.style.display = 'block';
                
                // Mostrar alerta de éxito
                mostrarAlertas([{
                    tipo: 'success',
                    mensaje: 'Pronóstico obtenido exitosamente',
                    detalle: 'Datos en tiempo real de CurrentUVIndex API'
                }]);
                
            } catch (error) {
                console.error('Error:', error);
                mostrarError('Error al obtener el pronóstico: ' + error.message);
            } finally {
                loading.style.display = 'none';
            }
        }

        // Permitir Enter en los inputs
        document.getElementById('latInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') obtenerRadiacion();
        });

        document.getElementById('lngInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') obtenerRadiacion();
        });

        // Cargar datos iniciales al abrir la página
        document.addEventListener('DOMContentLoaded', function() {
            // Animar con datos de Lima por defecto
            setTimeout(() => {
                obtenerRadiacion();
            }, 500);
        });
    