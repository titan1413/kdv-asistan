def build_imalat_formats(workbook) -> dict:
    """İmalat Excel dışa aktarımı için ortak xlsxwriter format nesnelerini oluşturur.

    Returns:
        dict: 'header', 'urun_kodu', 'donem_adi', 'imalat_tarihi', 'gg', 'satis', 'normal' anahtarlarını içerir.
    """
    return {
        'header': workbook.add_format({
            'bold': True,
            'align': 'center',
            'valign': 'vcenter',
            'border': 1,
            'bg_color': '#2c3e50',
            'font_color': 'white'
        }),
        'urun_kodu': workbook.add_format({
            'bold': True,
            'align': 'center',
            'valign': 'vcenter',
            'border': 1,
            'bg_color': '#f58845',
            'font_color': 'white',
            'font_size': 12
        }),
        'donem_adi': workbook.add_format({
            'bold': True,
            'align': 'left',
            'valign': 'vcenter',
            'border': 1,
            'bg_color': '#e2e8f0',
            'font_color': '#1e293b'
        }),
        'imalat_tarihi': workbook.add_format({
            'align': 'left',
            'valign': 'vcenter',
            'border': 1,
            'bg_color': '#f1f5f9',
            'font_color': '#64748b',
            'font_size': 10
        }),
        'gg': workbook.add_format({
            'align': 'center',
            'valign': 'vcenter',
            'border': 1,
            'bg_color': '#fef9e7'
        }),
        'satis': workbook.add_format({
            'align': 'center',
            'valign': 'vcenter',
            'border': 1,
            'bg_color': '#ebf5fb'
        }),
        'normal': workbook.add_format({
            'align': 'center',
            'valign': 'vcenter',
            'border': 1
        }),
    }
